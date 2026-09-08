import { getRecipeNutrition, recipeMeetsFoodRestrictions } from "./catalog.js";
import { NutritionGenerationError } from "./errors.js";
import { executeNutritionFunction, type NutritionFunctionResult } from "./function-calling.js";
import type { MealSelection } from "./generation.js";
import type { RecipeRetrievalContext } from "./rag.js";
import type { NutritionPreferences, NutritionValues } from "./types.js";
import { restrictiveDietaryTags } from "./dietary-policy.js";
import { planningFamily, recipePlanningWarning } from "./planning-quality.js";

const measures = ["caloriesKcal", "proteinG", "carbsG", "fatsG"] as const;
const labels = ["calories", "protein", "carbohydrates", "fat"];

type ReviewTargets = Pick<NutritionPreferences, "calorieTargetKcal" | "macroTargets">;

export interface NutritionPlanReview extends Record<string, unknown> {
  status: "review" | "within_range";
  gaps: string[];
  excesses: string[];
  differences: Array<{ nutrient: string; actual: number; target: number; difference: number }>;
  needsCorrection: boolean;
  summary: string;
}

function targets(preferences: ReviewTargets): number[] {
  return [preferences.calorieTargetKcal, preferences.macroTargets.proteinG,
    preferences.macroTargets.carbsG, preferences.macroTargets.fatsG];
}

export function reviewNutrition(nutrition: NutritionValues, preferences: ReviewTargets): NutritionPlanReview {
  const goals = targets(preferences);
  const gaps: string[] = [];
  const excesses: string[] = [];
  const differences = measures.map((measure, index) => {
    const actual = nutrition[measure];
    const target = goals[index];
    if (actual < target * 0.9) gaps.push(labels[index]);
    if (actual > target * 1.1) excesses.push(labels[index]);
    return { nutrient: labels[index], actual, target, difference: actual - target };
  });
  const needsCorrection = gaps.length > 0 || excesses.length > 0;
  return {
    status: needsCorrection ? "review" : "within_range", gaps, excesses, differences, needsCorrection,
    summary: needsCorrection
      ? "Some calculated nutrients remain outside 10% of the saved targets. Review the remaining gaps and excesses."
      : "All four calculated nutrients are within 10% of the saved targets.",
  };
}

function calculate(selections: MealSelection[]): NutritionFunctionResult {
  return executeNutritionFunction({ name: "calculate_day_nutrition", arguments: {
    meals: selections.map(({ recipeId, servings }) => ({ recipeId, servings })),
  } });
}

export interface CorrectedMealSelections {
  selections: MealSelection[];
  nutrition: NutritionFunctionResult;
  review: Record<string, unknown>;
  correction: Record<string, unknown>;
}

export function correctMealSelections(
  selections: MealSelection[], preferences: NutritionPreferences, retrieval: RecipeRetrievalContext,
  priorRecipeCounts: ReadonlyMap<string, number> = new Map(),
): CorrectedMealSelections {
  const candidates = retrieval.retrievedRecipes.filter(({ recipe }) => !recipePlanningWarning(recipe) && recipeMeetsFoodRestrictions(recipe, {
    dietaryTags: restrictiveDietaryTags(preferences.dietaryPreferences), allergies: preferences.allergies,
    excludedIngredients: preferences.dislikedIngredients,
  })).slice(0, 32).map(({ recipe }) => ({ recipeId: recipe.id, family: planningFamily(recipe), meal: recipe.meal, nutrition: getRecipeNutrition(recipe) }));
  if (selections.length < 1 || selections.length > 13 || candidates.length === 0
    || selections.some((meal) => !candidates.some((candidate) => candidate.recipeId === meal.recipeId)
      || !Number.isFinite(meal.servings) || meal.servings < 0.25 || meal.servings > 4)) {
    throw new NutritionGenerationError("invalid_parameters", "Correction needs one to thirteen restricted catalogue meals with valid amounts.", 400, false);
  }
  const goals = targets(preferences);
  const score = (values: number[]) => values.reduce((sum, value, index) => {
    const deviation = Math.abs(value - goals[index]) / Math.max(goals[index], 1);
    return sum + deviation ** 2 + (deviation > 0.1 ? 10 : 0);
  }, 0);
  const vector = (meal: MealSelection) => {
    const candidate = candidates.find((item) => item.recipeId === meal.recipeId)!;
    return measures.map((key) => candidate.nutrition[key] * meal.servings);
  };
  const total = (meals: MealSelection[]) => meals.reduce((sum, meal) =>
    vector(meal).map((value, index) => value + sum[index]), [0, 0, 0, 0]);
  const beforeNutrition = calculate(selections);
  const beforeReview = reviewNutrition(beforeNutrition.value.nutrition as NutritionValues, preferences);
  const corrected = selections.map((meal) => ({ ...meal }));
  const diverse = retrieval.planning === true;
  const repetitionLimit = Math.max(1, Math.ceil(selections.length / candidates.length));
  const permitted = (recipeId: string, index: number, meals: MealSelection[]) => {
    if (!diverse) return true;
    const family = candidates.find(item => item.recipeId === recipeId)!.family;
    const candidate = candidates.find(item => item.recipeId === recipeId)!;
    const slot = meals[index].mealType;
    const preferredRoles = slot.startsWith("snack") ? ["snack", "breakfast"] : slot === "breakfast" ? ["breakfast"] : ["dinner", "lunch"];
    if (candidates.some(item => preferredRoles.includes(item.meal)) && !preferredRoles.includes(candidate.meal)) return false;
    const others = meals.filter((_meal, position) => position !== index);
    const morning = slot === "breakfast" || slot.startsWith("snack");
    const roleCount = candidates.filter(item => (morning ? ["breakfast", "snack"] : ["dinner", "lunch"]).includes(item.meal)).length;
    const slotCount = selections.filter(item => (item.mealType === "breakfast" || item.mealType.startsWith("snack")) === morning).length;
    const roleLimit = roleCount ? Math.ceil(slotCount / roleCount) : repetitionLimit;
    if (others.filter(meal => meal.recipeId === recipeId).length >= Math.max(repetitionLimit, roleLimit)) return false;
    if (family === "bread" && others.some(meal => candidates.find(item => item.recipeId === meal.recipeId)!.family === "bread")) return false;
    if (family === "sweet" && others.filter(meal => candidates.find(item => item.recipeId === meal.recipeId)!.family === "sweet").length >= Math.max(1, preferences.snacksPerDay)) return false;
    return true;
  };
  const objective = (meals: MealSelection[]) => score(total(meals)) + (diverse
    ? meals.reduce((sum, meal) => sum + 0.03 * (priorRecipeCounts.get(meal.recipeId) ?? 0), 0)
    : 0);
  const beforeScore = objective(corrected);
  // Repair duplicate/family-heavy model selections before optimizing their quantities.
  if (diverse) {
    for (let index = 0; index < corrected.length; index += 1) {
      const allocated = corrected.slice(0, index + 1);
      if (permitted(corrected[index].recipeId, index, allocated)) continue;
      const choices = candidates.filter(candidate => permitted(candidate.recipeId, index, allocated));
      choices.sort((a, b) => (priorRecipeCounts.get(a.recipeId) ?? 0) - (priorRecipeCounts.get(b.recipeId) ?? 0));
      const candidate = choices[0];
      if (!candidate) throw new NutritionGenerationError("missing_ingredient", "Not enough distinct meal recipes match these restrictions. Reduce the meal count or review your preferences.", 422, false);
      corrected[index] = { ...corrected[index], recipeId: candidate.recipeId,
        servings: Math.min(4, Math.max(0.25, Math.round(preferences.calorieTargetKcal / corrected.length / candidate.nutrition.caloriesKcal * 100) / 100)),
        reason: "Selected a different eligible recipe to preserve meal variety." };
    }
  }
  let bestScore = objective(corrected);
  let iterations = 0;
  // Coordinate descent bounds the search and accepts only a lower combined target error.
  if (beforeReview.needsCorrection || diverse) {
    for (let pass = 0; pass < 8; pass += 1) {
      let improved = false;
      for (let index = 0; index < corrected.length; index += 1) {
        const current = corrected[index];
        const currentVector = vector(current);
        const other = total(corrected).map((value, axis) => value - currentVector[axis]);
        let best = current;
        for (const candidate of candidates) {
          if (!permitted(candidate.recipeId, index, corrected)) continue;
          const values = measures.map((key) => candidate.nutrition[key]);
          let numerator = 0;
          let denominator = 0;
          for (let axis = 0; axis < measures.length; axis += 1) {
            const weight = 1 / Math.max(goals[axis], 1) ** 2;
            numerator += values[axis] * (goals[axis] - other[axis]) * weight;
            denominator += values[axis] ** 2 * weight;
          }
          const amounts = [denominator ? numerator / denominator : 0.25, current.servings - 0.01, current.servings + 0.01];
          for (let axis = 0; axis < measures.length; axis += 1) {
            if (values[axis] > 0) for (const bound of [0.9, 1.1]) amounts.push((goals[axis] * bound - other[axis]) / values[axis]);
          }
          for (const servings of new Set(amounts.filter(Number.isFinite).map(amount => Math.min(4, Math.max(0.25, Math.round(amount * 100) / 100))))) {
            const candidateMeals = corrected.map((meal, position) => position === index ? { ...meal, recipeId: candidate.recipeId, servings } : meal);
            const candidateScore = objective(candidateMeals);
            if (candidateScore + 0.000000001 < bestScore) {
              bestScore = candidateScore;
              best = { ...current, recipeId: candidate.recipeId, servings,
                reason: "Adjusted using calculated nutrition and the saved food restrictions." };
            }
          }
        }
        if (best !== current) { corrected[index] = best; improved = true; }
      }
      iterations += 1;
      if (!improved) break;
    }
  }
  const nutrition = calculate(corrected);
  const review = reviewNutrition(nutrition.value.nutrition as NutritionValues, preferences);
  const changedMeals = corrected.flatMap((meal, index) => meal.recipeId !== selections[index].recipeId
    || meal.servings !== selections[index].servings ? [{ mealType: meal.mealType,
      before: { recipeId: selections[index].recipeId, servings: selections[index].servings },
      after: { recipeId: meal.recipeId, servings: meal.servings } }] : []);
  return { selections: corrected, nutrition, review, correction: {
    required: beforeReview.needsCorrection || (diverse && changedMeals.length > 0), applied: changedMeals.length > 0,
    action: changedMeals.length > 0 ? "adjusted_servings_or_recipes" : "none",
    reasons: [...beforeReview.gaps as string[], ...beforeReview.excesses as string[], ...(diverse && changedMeals.length > 0 ? ["meal_variety"] : [])],
    keepsSavedPreferences: true, changedMeals, iterations, boundedSearch: true,
    beforeScore, afterScore: bestScore, beforeNutrition, afterNutrition: nutrition, beforeReview, residualReview: review,
  } };
}
