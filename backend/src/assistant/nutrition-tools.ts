import type { HealthProfile } from "../profile.js";
import { getRecipe, getRecipeNutrition, recipeMeetsFoodRestrictions } from "../nutrition/catalog.js";
import { restrictiveDietaryTags } from "../nutrition/dietary-policy.js";
import { getRecipeCreation } from "../nutrition/recipe-creations.js";
import { getNutritionPreferences } from "../nutrition/storage.js";
import { deriveNutritionDefaults } from "../nutrition/preferences.js";
import { listIntakeRecords } from "../nutrition/intake.js";
import { buildNutritionPeriod, buildNutritionProgress } from "../nutrition/analysis.js";
import { listMealPlans } from "../nutrition/meal-plan-storage.js";
import type { PlannedMeal } from "../nutrition/meal-plans.js";
import { recipePlanningWarning } from "../nutrition/planning-quality.js";
import { failed, formatNumber as number, periodRange, resolveDate, safeDataText, shiftDate, todayForUser } from "./data.js";
import type { ChatReference, ChatSection, ToolResult } from "./types.js";

function currentPlans(userId: number) {
  return listMealPlans(userId, 50).sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}

function mealsForDate(userId: number, date: string): PlannedMeal[] {
  return currentPlans(userId).find((plan) => plan.days.some((day) => day.date === date))?.days.find((day) => day.date === date)?.meals ?? [];
}

function selectedDate(userId: number, args: Record<string, unknown>, now: Date): string {
  return resolveDate((args.date ?? "today") as string, todayForUser(userId, now))!;
}

export function mealPlan(userId: number, args: Record<string, unknown>, now: Date): ToolResult {
  const startDate = selectedDate(userId, args, now);
  const days = args.days === 7 ? 7 : 1;
  const sections: ChatSection[] = [];
  const plans = currentPlans(userId);
  let found = false;
  for (let offset = 0; offset < days; offset += 1) {
    const date = shiftDate(startDate, offset);
    const day = plans.find((plan) => plan.days.some((entry) => entry.date === date))?.days.find((entry) => entry.date === date);
    const meals = day?.meals.filter((meal) => !args.mealType || meal.mealType === args.mealType) ?? [];
    found ||= meals.length > 0;
    sections.push({
      title: `Meal plan for ${date}`, kind: "plan",
      lines: meals.length ? [...meals.map((meal) => `${meal.mealType} at ${meal.time}: ${safeDataText(meal.title)} (${number(meal.nutrition.caloriesKcal)} kcal)`), "These are planned meals, not recorded intake."]
        : ["No matching meals were found in your recent saved plans for this date."],
      details: meals.flatMap((meal) => [`${safeDataText(meal.title)}: ${number(meal.servings, 3)} servings; protein ${number(meal.nutrition.proteinG)} g, carbohydrate ${number(meal.nutrition.carbsG)} g, fat ${number(meal.nutrition.fatsG)} g`]),
    });
  }
  if (!found && days === 1) return failed("not_found", `No meals were found in your recent saved plans for ${startDate}. Open Meal plan to create or review a plan.`);
  return { ok: found, ...(!found ? { code: "not_found" as const } : {}), section: sections[0], ...(days > 1 ? { sections } : {}), reference: { topic: "meal", date: startDate, ...(args.mealType ? { mealType: args.mealType as ChatReference["mealType"] } : {}) } };
}

function dietarySuggestions(preferences: ReturnType<typeof deriveNutritionDefaults>): string[] {
  return [
    `Choose a protein-containing recipe that follows your saved ${preferences.dietaryPreferences.map(safeDataText).join(", ") || "dietary"} preferences.`,
    ...(preferences.allergies.length ? [`Keep your saved restrictions in place: ${preferences.allergies.map(safeDataText).join(", ")}.`] : []),
    "Check that all eaten meals are recorded before deciding whether your intake needs to change.",
  ];
}

export function nutritionIntake(userId: number, profile: HealthProfile, args: Record<string, unknown>, now: Date): ToolResult {
  const preferences = getNutritionPreferences(userId) ?? deriveNutritionDefaults(profile);
  const records = listIntakeRecords(userId, { limit: 1000 });
  const progress = buildNutritionProgress({ profile, preferences, records, now: () => now });
  const periodName = (args.period ?? "today") as "today" | "week" | "month" | "last_month";
  const today = todayForUser(userId, now);
  const range = periodName === "month" ? { from: shiftDate(today, -29), to: today } : periodRange(today, periodName);
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000) + 1;
  const period = periodName === "last_month" ? buildNutritionPeriod(records, range.to, days, preferences) : periodName === "month" ? progress.month : periodName === "week" ? progress.week : progress.today;
  const label = periodName === "today" ? "today" : periodName === "week" ? "the last seven days" : periodName === "month" ? "the last thirty days" : "the previous calendar month";
  if (period.recordCount === 0) return failed("not_found", `No intake was recorded for ${label}. Record eaten meals in Nutrition to compare them with your targets.`);
  const proteinGap = period.targets.proteinG - period.nutrition.proteinG;
  const section: ChatSection = {
    title: periodName === "today" ? "Today's recorded intake" : `Recorded intake over ${label}`, kind: "nutrition",
    lines: [
      `Energy: ${number(period.nutrition.caloriesKcal)} / ${number(period.targets.caloriesKcal)} kcal`,
      `Protein: ${number(period.nutrition.proteinG)} / ${number(period.targets.proteinG)} g`,
      `Carbohydrates: ${number(period.nutrition.carbsG)} / ${number(period.targets.carbsG)} g`,
      `Fat: ${number(period.nutrition.fatsG)} / ${number(period.targets.fatsG)} g`,
      proteinGap > 0 ? `Recorded protein is ${number(proteinGap)} g below the saved target for this period.` : "Recorded protein meets or exceeds the saved target for this period.",
      "Only recorded food is counted; unlogged meals are unknown.",
    ],
    details: [`Period: ${range.from} to ${range.to}`, `Recorded meals or entries: ${period.recordCount}`, `Daily average recorded protein: ${number(period.dailyAverage.proteinG)} g`, `Daily average recorded energy: ${number(period.dailyAverage.caloriesKcal)} kcal`, ...dietarySuggestions(preferences)],
  };
  if (proteinGap > 0) section.lines.push(dietarySuggestions(preferences)[0]);
  if (args.view === "trend") {
    const dates = [...new Set(records.filter((record) => record.date >= range.from && record.date <= range.to).map((record) => record.date))].sort();
    section.title = "Recorded nutrition trend";
    section.lines.unshift(`Period: ${range.from} to ${range.to}`);
    if (dates.length < 2) section.lines.push("Only one logged date is available, so a trend cannot be determined.");
    else {
      const first = buildNutritionPeriod(records, dates[0], 1, preferences).nutrition;
      const last = buildNutritionPeriod(records, dates.at(-1)!, 1, preferences).nutrition;
      section.lines.push(`Recorded protein: ${number(first.proteinG)} g on ${dates[0]} to ${number(last.proteinG)} g on ${dates.at(-1)}.`, `Recorded energy: ${number(first.caloriesKcal)} kcal to ${number(last.caloriesKcal)} kcal between those logged dates.`, `Recorded protein ${Math.abs(last.proteinG - first.proteinG) < 0.1 ? "ended close to where it started" : last.proteinG > first.proteinG ? "increased" : "decreased"} between the first and last logged dates.`, "This describes logged food only. Days with no records are unknown, not evidence of zero intake.");
    }
  }
  return { ok: true, section, reference: { topic: "nutrition", period: periodName, view: args.view === "trend" ? "trend" : "summary" } };
}

export function recipeInformation(userId: number, profile: HealthProfile, args: Record<string, unknown>, now: Date): ToolResult {
  const date = selectedDate(userId, args, now);
  const preferences = getNutritionPreferences(userId) ?? deriveNutritionDefaults(profile);
  let meal: PlannedMeal | undefined;
  if (!args.recipeId) {
    const matching = mealsForDate(userId, date).filter((item) => item.mealType === args.mealType);
    if (matching.length > 1) return failed("not_found", `There is more than one ${args.mealType} entry for ${date}. Ask with a specific recipe identifier from the Recipes page.`);
    meal = matching[0];
    if (!meal) return failed("not_found", `No ${args.mealType} was found in your saved plan for ${date}.`);
  }
  const recipeId = (args.recipeId ?? meal?.recipeId) as string | undefined;
  const recipe = meal?.recipeSnapshot ?? (recipeId ? getRecipe(recipeId) ?? getRecipeCreation(userId, recipeId)?.recipe : undefined);
  if (!recipe) return failed("not_found", meal?.manual ? "This meal was entered manually and has no stored ingredient list or preparation steps." : "This recipe is not available in your catalogue or saved account recipes.");
  const servings = (args.servings as number | undefined) ?? meal?.servings ?? recipe.servings;
  const nutrition = getRecipeNutrition(recipe, servings);
  const warning = recipePlanningWarning(recipe);
  const mealLabel = meal ? `${meal.mealType} on ${date}` : "Selected recipe";
  const title = safeDataText(recipe.title);
  const summary: ChatSection = { title, kind: "recipe", lines: [`${mealLabel}: ${number(servings, 3)} servings`, `Energy: ${number(nutrition.caloriesKcal)} kcal`, `Protein: ${number(nutrition.proteinG)} g`, `Carbohydrates: ${number(nutrition.carbsG)} g`, `Fat: ${number(nutrition.fatsG)} g`], details: [`Preparation time: ${number(recipe.time)} minutes`, `Cuisine: ${safeDataText(recipe.cuisine)}`, `Difficulty: ${recipe.difficulty_level}`] };
  if (!recipeMeetsFoodRestrictions(recipe, { dietaryTags: restrictiveDietaryTags(preferences.dietaryPreferences), allergies: [...new Set([...preferences.allergies, ...profile.dietaryRestrictions])], excludedIngredients: preferences.dislikedIngredients })) {
    summary.lines.unshift("This saved recipe conflicts with your current food restrictions. Review the plan and choose a suitable alternative before preparing it.");
  }
  if (preferences.macroTargets.proteinG > 0) summary.lines.push(`Protein share of your daily target: ${number(nutrition.proteinG / preferences.macroTargets.proteinG * 100)}% (${number(preferences.macroTargets.proteinG)} g per day)`);
  summary.lines.push("A single meal does not need to meet the whole day's protein target. This is planned recipe nutrition, not proof that the meal was eaten.");
  if (warning) summary.lines.push(`Recipe note: ${safeDataText(warning)}`);
  const sections = [summary];
  if (args.view !== "nutrition") {
    if (!recipe.ingredients.length || !recipe.preparation.length) return failed("unavailable", "The recipe is incomplete. Open Recipes to review it before preparing the meal.");
    sections.push({ title: "Ingredients", kind: "recipe", lines: recipe.ingredients.map((ingredient) => `${safeDataText(ingredient.name)}: ${number(ingredient.quantity * servings / recipe.servings, 2)} ${ingredient.unit}`) });
    sections.push({ title: "Preparation", kind: "recipe", ordered: true, lines: [...recipe.preparation].sort((first, second) => first.step - second.step).map((step) => safeDataText(step.description)) });
  }
  return { ok: true, section: summary, sections, reference: { topic: "recipe", date, ...(meal ? { mealType: meal.mealType as ChatReference["mealType"] } : {}), recipeId: recipeId ?? recipe.id, servings, view: args.view === "nutrition" ? "nutrition" : "recipe" } };
}
