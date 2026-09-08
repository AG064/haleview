import { defaultTimezone, localDateTimeToIso, TimezoneValidationError } from "../timezone.js";
import { randomUUID } from "node:crypto";
import { getRecipe, getRecipeNutrition, searchRecipeCandidates } from "./catalog.js";
import { eligibleForPlanning, recipePlanningWarning } from "./planning-quality.js";
import { generateMealDraft, type MealDraftOptions, type MealSelection } from "./generation.js";
import { parseNutritionPreferences } from "./preferences.js";
import { restrictiveDietaryTags, dietaryStylePreferences } from "./dietary-policy.js";
import { correctMealSelections, reviewNutrition, type NutritionPlanReview } from "./planning-review.js";
import { micronutrientReferences } from "./micronutrients.js";
import type { NutritionPreferences, NutritionValues, RecipeSearchResult, RecipeRecord } from "./types.js";

export type PlanDuration = "day" | "week";
export type PlanSource = "local" | "deepseek" | "cache";

export interface PlanTargets {
  calorieTargetKcal: number;
  macroTargets: {
    proteinG: number;
    carbsG: number;
    fatsG: number;
  };
}

export interface PlannedMeal {
  id: string;
  date: string;
  scheduledAt: string | null;
  order: number;
  mealType: string;
  time: string;
  recipeId: string | null;
  title: string;
  servings: number;
  nutrition: NutritionValues;
  source: "catalog" | "manual" | "generated";
  recipeSnapshot?: RecipeRecord;
  manual: boolean;
  reason: string;
  notes: string;
}

export interface MealPlanDay {
  date: string;
  meals: PlannedMeal[];
  nutrition: NutritionValues;
  review?: NutritionPlanReview;
}

export interface MealPlan {
  timezone: string;
  id: string;
  duration: PlanDuration;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  source: PlanSource;
  fallbackReason: string | null;
  model: string | null;
  generationSteps: string[];
  targets: PlanTargets;
  days: MealPlanDay[];
  nutrition: NutritionValues;
  insights: MealPlanInsights;
}

export interface MealPlanInsights {
  nutritionalBalanceScore: number;
  diversityIndex: number;
  micronutrientCoverage: { percentage: number; low: string[]; high: string[] };
  weeklyTrends: {
    proteinConsistency: "high" | "moderate" | "variable";
    fiberTrend: "increasing" | "steady" | "decreasing";
    sugarTrend: "increasing" | "steady" | "decreasing";
  };
  calculationBasis: "catalogue_nutrients";
}

export interface BuildMealPlanInput {
  timezone?: string;
  id: string;
  duration: PlanDuration;
  startDate: string;
  createdAt: string;
  source: PlanSource;
  fallbackReason?: string | null;
  model?: string | null;
  generationSteps?: string[];
  targets?: PlanTargets;
  days: Array<{ date: string; selections: MealSelection[] }>;
}

export interface ManualMealInput {
  id?: string;
  date: string;
  mealType: string;
  time: string;
  title: string;
  nutrition: NutritionValues;
  notes?: string;
}

export class PlanValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

const nutritionKeys: Array<keyof NutritionValues> = [
  "caloriesKcal",
  "proteinG",
  "carbsG",
  "fatsG",
  "fiberG",
  "sugarG",
  "sodiumMg",
  "vitaminDMcg",
  "vitaminB12Mcg",
  "ironMg",
  "calciumMg",
  "magnesiumMg",
];

const knownMealTypes = new Set(["breakfast", "lunch", "dinner", "snack"]);

export function emptyNutrition(): NutritionValues {
  return {
    caloriesKcal: 0,
    proteinG: 0,
    carbsG: 0,
    fatsG: 0,
    fiberG: 0,
    sugarG: 0,
    sodiumMg: 0,
    vitaminDMcg: 0,
    vitaminB12Mcg: 0,
    ironMg: 0,
    calciumMg: 0,
    magnesiumMg: 0,
  };
}

function round(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

export function addNutrition(target: NutritionValues, value: NutritionValues): void {
  for (const key of nutritionKeys) {
    target[key] = round(target[key] + value[key]);
  }
}

function validDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new PlanValidationError(`${field} must use YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new PlanValidationError(`${field} is not a valid calendar date.`);
  }
  return value;
}

function validTime(value: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(value)) {
    throw new PlanValidationError("Meal time must use HH:mm format.");
  }
  return value;
}

function validServings(value: number): number {
  if (!Number.isFinite(value) || value < 0.25 || value > 100) {
    throw new PlanValidationError("Servings must be between 0.25 and 100.");
  }
  return round(value);
}

function validText(value: string, field: string, maximum: number): string {
  const clean = value.trim();
  if (!clean || clean.length > maximum) {
    throw new PlanValidationError(`${field} is required and must be short enough.`);
  }
  return clean;
}

function validNutrition(value: NutritionValues): NutritionValues {
  for (const key of nutritionKeys) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0) {
      throw new PlanValidationError(`${key} must be a non-negative number.`);
    }
  }
  return { ...value };
}

function datesForPlan(startDate: string, duration: PlanDuration): string[] {
  validDate(startDate, "Start date");
  const count = duration === "week" ? 7 : 1;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const next = new Date(start);
    next.setUTCDate(start.getUTCDate() + index);
    return next.toISOString().slice(0, 10);
  });
}

function planNutrition(days: MealPlanDay[]): NutritionValues {
  const result = emptyNutrition();
  days.forEach((day) => addNutrition(result, day.nutrition));
  return result;
}

function dayNutrition(meals: PlannedMeal[]): NutritionValues {
  const result = emptyNutrition();
  meals.forEach((meal) => addNutrition(result, meal.nutrition));
  return result;
}

function orderedMeals(meals: PlannedMeal[]): PlannedMeal[] {
  return meals.map((meal, index) => ({ ...meal, order: index }));
}

function closeness(value: number, target: number): number {
  if (target <= 0) return 1;
  return Math.max(0, 1 - Math.abs(value - target) / target);
}

function trend(values: number[]): "increasing" | "steady" | "decreasing" {
  if (values.length < 2) return "steady";
  const first = values[0];
  const last = values.at(-1) ?? first;
  const baseline = Math.max(1, Math.abs(first));
  const change = (last - first) / baseline;
  if (change > 0.1) return "increasing";
  if (change < -0.1) return "decreasing";
  return "steady";
}

function planInsights(days: MealPlanDay[], targets: PlanTargets): MealPlanInsights {
  const dayCount = Math.max(1, days.length);
  const balanceParts = days.flatMap((day) => [
    closeness(day.nutrition.caloriesKcal, targets.calorieTargetKcal),
    closeness(day.nutrition.proteinG, targets.macroTargets.proteinG),
    closeness(day.nutrition.carbsG, targets.macroTargets.carbsG),
    closeness(day.nutrition.fatsG, targets.macroTargets.fatsG),
  ]);
  const balance = balanceParts.length > 0
    ? balanceParts.reduce((total, value) => total + value, 0) / balanceParts.length
    : 0;
  const meals = days.flatMap((day) => day.meals);
  const mealKeys = new Set(meals.map((meal) => meal.recipeId ?? `manual:${meal.title.toLowerCase()}`));
  const ingredientIds = new Set(meals.flatMap((meal) => meal.recipeId
    ? (getRecipe(meal.recipeId)?.ingredients.map((item) => item.id) ?? [])
    : []));
  const mealVariety = meals.length > 0 ? mealKeys.size / meals.length : 0;
  const ingredientVariety = Math.min(1, ingredientIds.size / Math.max(8, dayCount * 8));
  const totals = planNutrition(days);
  const low: string[] = [];
  const high: string[] = [];
  const coverageValues = micronutrientReferences.map((reference) => {
    const daily = totals[reference.key] / dayCount;
    const ratio = reference.target > 0 ? daily / reference.target : 0;
    if (reference.kind === "maximum") {
      if (ratio > 1) high.push(reference.label);
      return Math.min(1, ratio > 0 ? 1 / ratio : 1);
    }
    if (ratio < 0.75) low.push(reference.label);
    return Math.min(1, ratio);
  });
  const proteins = days.map((day) => day.nutrition.proteinG);
  const proteinAverage = proteins.reduce((total, value) => total + value, 0) / dayCount;
  const proteinVariance = proteins.reduce((total, value) => total + (value - proteinAverage) ** 2, 0) / dayCount;
  const proteinVariation = proteinAverage > 0 ? Math.sqrt(proteinVariance) / proteinAverage : 1;
  return {
    nutritionalBalanceScore: Math.round(balance * 100) / 10,
    diversityIndex: Math.round((mealVariety * 0.6 + ingredientVariety * 0.4) * 100) / 10,
    micronutrientCoverage: {
      percentage: Math.round(coverageValues.reduce((total, value) => total + value, 0) / coverageValues.length * 100),
      low,
      high,
    },
    weeklyTrends: {
      proteinConsistency: proteinVariation <= 0.1 ? "high" : proteinVariation <= 0.25 ? "moderate" : "variable",
      fiberTrend: trend(days.map((day) => day.nutrition.fiberG)),
      sugarTrend: trend(days.map((day) => day.nutrition.sugarG)),
    },
    calculationBasis: "catalogue_nutrients",
  };
}

function clonePlan(plan: MealPlan): MealPlan {
  return JSON.parse(JSON.stringify(plan)) as MealPlan;
}

function scheduledInstant(date: string, time: string, timezone: string): string {
  try {
    return localDateTimeToIso(`${date}T${time}`, timezone);
  } catch (error) {
    if (error instanceof TimezoneValidationError) throw new PlanValidationError(error.message);
    throw error;
  }
}

/** Legacy skipped times remain visible and unscheduled until the user edits them. */
export function normalizePlanSchedule(plan: MealPlan): MealPlan {
  const timezone = plan.timezone ?? defaultTimezone();
  return { ...plan, timezone, days: plan.days.map((day) => ({
    ...day, meals: day.meals.map((meal) => {
      if (meal.scheduledAt !== undefined) return meal;
      try {
        return { ...meal, scheduledAt: scheduledInstant(meal.date, meal.time, timezone) };
      } catch (error) {
        if (error instanceof PlanValidationError) return { ...meal, scheduledAt: null };
        throw error;
      }
    }),
  })) };
}

export function buildMealPlan(input: BuildMealPlanInput): MealPlan {
  const id = validText(input.id, "Plan id", 120);
  const timezone = input.timezone ?? defaultTimezone();
  const expectedDates = datesForPlan(input.startDate, input.duration);
  if (input.days.length !== expectedDates.length) {
    throw new PlanValidationError(`A ${input.duration} plan must contain ${expectedDates.length} day.`);
  }
  const suppliedDates = input.days.map((day) => validDate(day.date, "Plan day"));
  if (suppliedDates.some((date, index) => date !== expectedDates[index])) {
    throw new PlanValidationError("Plan days must be consecutive and start on the selected date.");
  }

  const days = input.days.map((day, dayIndex) => {
    const meals = day.selections.map((selection, mealIndex) => {
      const recipe = getRecipe(selection.recipeId);
      if (recipe && recipePlanningWarning(recipe)) throw new PlanValidationError(recipePlanningWarning(recipe)!);
      if (!recipe) {
        throw new PlanValidationError("A selected recipe is not available in the catalogue.");
      }
      const servings = validServings(selection.servings);
      return {
        id: `${id}-${dayIndex + 1}-${mealIndex + 1}`,
        date: day.date,
        scheduledAt: scheduledInstant(day.date, selection.time, timezone),
        order: mealIndex,
        mealType: validText(selection.mealType, "Meal type", 50),
        time: validTime(selection.time),
        recipeId: recipe.id,
        title: recipe.title,
        servings,
        nutrition: getRecipeNutrition(recipe, servings),
        source: "catalog" as const,
        manual: false,
        reason: validText(selection.reason, "Meal reason", 500),
        notes: "",
      };
    });
    return { date: day.date, meals, nutrition: dayNutrition(meals) };
  });

  const targets = input.targets ?? {
    calorieTargetKcal: 0,
    macroTargets: { proteinG: 0, carbsG: 0, fatsG: 0 },
  };
  if (!Number.isFinite(targets.calorieTargetKcal) || targets.calorieTargetKcal < 0) {
    throw new PlanValidationError("The calorie target is invalid.");
  }

  const planTargets = {
    calorieTargetKcal: targets.calorieTargetKcal,
    macroTargets: { ...targets.macroTargets },
  };
  const reviewedDays = days.map((day) => ({ ...day,
    ...(planTargets.calorieTargetKcal > 0 ? { review: reviewNutrition(day.nutrition, planTargets) } : {}),
  }));
  return {
    id,
    timezone,
    duration: input.duration,
    startDate: input.startDate,
    endDate: expectedDates.at(-1)!,
    createdAt: new Date(input.createdAt).toISOString(),
    updatedAt: new Date(input.createdAt).toISOString(),
    version: 0,
    source: input.source,
    fallbackReason: input.fallbackReason ?? null,
    model: input.model ?? null,
    generationSteps: [...(input.generationSteps ?? [])],
    targets: planTargets,
    days: reviewedDays,
    nutrition: planNutrition(reviewedDays),
    insights: planInsights(reviewedDays, planTargets),
  };
}

export function recalculateMealPlan(plan: MealPlan): MealPlan {
  const next = normalizePlanSchedule(clonePlan(plan));
  next.days = next.days.map((day) => {
    const nutrition = dayNutrition(day.meals);
    return { ...day, meals: orderedMeals(day.meals), nutrition,
      ...(next.targets.calorieTargetKcal > 0 ? { review: reviewNutrition(nutrition, next.targets) } : {}),
    };
  });
  next.nutrition = planNutrition(next.days);
  next.insights = planInsights(next.days, next.targets);
  return next;
}

function findMeal(plan: MealPlan, mealId: string): { dayIndex: number; mealIndex: number } {
  for (let dayIndex = 0; dayIndex < plan.days.length; dayIndex += 1) {
    const mealIndex = plan.days[dayIndex].meals.findIndex((meal) => meal.id === mealId);
    if (mealIndex >= 0) return { dayIndex, mealIndex };
  }
  throw new PlanValidationError("The selected meal was not found.");
}

export function moveMeal(
  plan: MealPlan,
  mealId: string,
  targetDate: string,
  targetMealType?: string,
  targetTime?: string,
): MealPlan {
  const target = validDate(targetDate, "Target date");
  const next = clonePlan(plan);
  const location = findMeal(next, mealId);
  const targetDay = next.days.find((day) => day.date === target);
  if (!targetDay) {
    throw new PlanValidationError("The target date is not part of this plan.");
  }
  const [meal] = next.days[location.dayIndex].meals.splice(location.mealIndex, 1);
  meal.date = target;
  meal.mealType = validText(targetMealType ?? meal.mealType, "Meal type", 50);
  meal.time = validTime(targetTime ?? meal.time);
  meal.scheduledAt = scheduledInstant(meal.date, meal.time, next.timezone ?? defaultTimezone());
  targetDay.meals.push(meal);
  return recalculateMealPlan(next);
}

export function replaceMealWithRecipe(plan: MealPlan, mealId: string, recipeId: string, servings?: number): MealPlan {
  const next = clonePlan(plan);
  const location = findMeal(next, mealId);
  const meal = next.days[location.dayIndex].meals[location.mealIndex];
  const recipe = getRecipe(recipeId);
  if (recipe && recipePlanningWarning(recipe)) throw new PlanValidationError(recipePlanningWarning(recipe)!);
  if (!recipe) {
    throw new PlanValidationError("The selected recipe is not available in the catalogue.");
  }
  const nextServings = validServings(servings ?? meal.servings);
  delete meal.recipeSnapshot;
  next.days[location.dayIndex].meals[location.mealIndex] = {
    ...meal,
    recipeId: recipe.id,
    title: recipe.title,
    servings: nextServings,
    nutrition: getRecipeNutrition(recipe, nextServings),
    source: "catalog",
    manual: false,
    reason: "Changed by the user from the available recipe results.",
  };
  return recalculateMealPlan(next);
}

export function addManualMeal(plan: MealPlan, input: ManualMealInput): MealPlan {
  const next = clonePlan(plan);
  const date = validDate(input.date, "Meal date");
  const day = next.days.find((item) => item.date === date);
  if (!day) {
    throw new PlanValidationError("The meal date is not part of this plan.");
  }
  const meal: PlannedMeal = {
    id: input.id ?? `manual-${randomUUID()}`,
    date,
    scheduledAt: scheduledInstant(date, input.time, next.timezone ?? defaultTimezone()),
    order: day.meals.length,
    mealType: validText(input.mealType, "Meal type", 50),
    time: validTime(input.time),
    recipeId: null,
    title: validText(input.title, "Meal title", 160),
    servings: 1,
    nutrition: validNutrition(input.nutrition),
    source: "manual",
    manual: true,
    reason: "Entered by the user.",
    notes: input.notes ? validText(input.notes, "Meal notes", 500) : "",
  };
  day.meals.push(meal);
  return recalculateMealPlan(next);
}

export function findMealAlternatives(meal: PlannedMeal, preferences?: NutritionPreferences, limit = 6): RecipeSearchResult[] {
  const filters = preferences
    ? {
        dietaryTags: restrictiveDietaryTags(preferences.dietaryPreferences),
        query: [...preferences.cuisinePreferences, ...dietaryStylePreferences(preferences.dietaryPreferences)].join(" ").slice(0, 160),
        allergies: preferences.allergies,
        excludedIngredients: preferences.dislikedIngredients,
        maxCaloriesKcal: preferences.calorieTargetKcal / Math.max(preferences.mealsPerDay + preferences.snacksPerDay, 1) * 4,
      }
    : {};
  const mealFilter = knownMealTypes.has(meal.mealType) ? { meal: meal.mealType } : {};
  return searchRecipeCandidates({ ...filters, ...mealFilter })
    .filter((result) => result.recipe.id !== meal.recipeId && eligibleForPlanning(result.recipe))
    .slice(0, Math.min(Math.max(limit, 1), 20));
}

function fittedServings(calorieTarget: number, calories: number): number {
  const ratio = calorieTarget / Math.max(calories, 1);
  return Math.min(4, Math.max(0.25, round(ratio)));
}

function selectionsForDay(
  draft: Awaited<ReturnType<typeof generateMealDraft>>,
  preferences: NutritionPreferences,
  dayIndex: number,
  priorRecipeCounts: ReadonlyMap<string, number>,
): MealSelection[] {
  const candidates = draft.retrieval.retrievedRecipes;
  const targetPerMeal = preferences.calorieTargetKcal / Math.max(draft.structure.meals.length, 1);
  const proposed = draft.structure.meals.map((slot, mealIndex) => {
    if (dayIndex === 0) return draft.selections[mealIndex];
    const candidate = candidates[(mealIndex + dayIndex * 2) % candidates.length];
    return {
      mealType: slot.mealType,
      time: slot.time,
      recipeId: candidate.recipe.id,
      servings: fittedServings(targetPerMeal, candidate.nutrition.caloriesKcal),
      reason: "Selected from local results while keeping the saved restrictions.",
    };
  });
  return dayIndex === 0 ? proposed : correctMealSelections(proposed, preferences, draft.retrieval, priorRecipeCounts).selections;
}

export function addCreatedMeal(plan: MealPlan, recipe: RecipeRecord, input: { date: string; time: string; mealType: string }): MealPlan {
  if (recipePlanningWarning(recipe)) throw new PlanValidationError(recipePlanningWarning(recipe)!);
  const id = `created-meal-${randomUUID()}`;
  const next = addManualMeal(plan, { ...input, id, title: recipe.title, nutrition: getRecipeNutrition(recipe, recipe.servings) });
  const meal = next.days.flatMap(day => day.meals).find(item => item.id === id)!;
  meal.recipeId = recipe.id;
  meal.recipeSnapshot = structuredClone(recipe);
  meal.servings = recipe.servings;
  meal.manual = false;
  meal.source = "generated";
  meal.reason = "Created with Hale. Nutrition calculated from catalogue ingredients.";
  return recalculateMealPlan(next);
}

export interface MealPlanGenerationRequest {
  duration: PlanDuration;
  startDate: string;
  health: {
    bmi: number;
    targetWeightKg?: number;
    activityLevel: string;
    fitnessGoal: string;
  } & Record<string, unknown>;
  preferences: NutritionPreferences;
}

export async function generateMealPlan(
  request: MealPlanGenerationRequest,
  options: MealDraftOptions = {},
): Promise<MealPlan> {
  const preferences = parseNutritionPreferences(request.preferences, options.now?.() ?? new Date());
  const dates = datesForPlan(request.startDate, request.duration);
  const draft = await generateMealDraft({ health: request.health, preferences }, options);
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const priorRecipeCounts = new Map<string, number>();
  return buildMealPlan({
    id: `plan-${randomUUID()}`,
    timezone: preferences.timezone,
    duration: request.duration,
    startDate: request.startDate,
    createdAt,
    source: draft.source === "cache" ? "cache" : draft.source === "deepseek" ? "deepseek" : "local",
    fallbackReason: draft.fallbackReason,
    model: draft.model,
    generationSteps: draft.trace.map((entry) => entry.name),
    targets: {
      calorieTargetKcal: preferences.calorieTargetKcal,
      macroTargets: { ...preferences.macroTargets },
    },
    days: dates.map((date, dayIndex) => {
      const selections = selectionsForDay(draft, preferences, dayIndex, priorRecipeCounts);
      for (const selection of selections) priorRecipeCounts.set(selection.recipeId, (priorRecipeCounts.get(selection.recipeId) ?? 0) + 1);
      return { date, selections };
    }),
  });
}
