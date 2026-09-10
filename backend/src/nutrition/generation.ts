import { createHash } from "node:crypto";
import { activityLevels, fitnessGoals } from "../profile.js";
import { GenerationCache } from "./cache.js";
import { NutritionGenerationError, type NutritionGenerationErrorCode } from "./errors.js";
import {
  executeNutritionFunction,
  nutritionFunctionDefinitions,
  type NutritionFunctionCall,
  type NutritionFunctionResult,
} from "./function-calling.js";
import {
  buildNutritionPrompt,
  type NutritionModelSettings,
  type NutritionPromptName,
  type NutritionPromptRequest,
} from "./prompts.js";
import { correctMealSelections, reviewNutrition } from "./planning-review.js";
import type { NutritionProvider } from "./provider.js";
import { buildRecipeRetrievalContext, type RecipeRetrievalContext } from "./rag.js";
import { parseNutritionPreferences } from "./preferences.js";
import { restrictiveDietaryTags, dietaryStylePreferences } from "./dietary-policy.js";
import type { NutritionPreferences, NutritionValues } from "./types.js";

interface GenerationHealthInput {
  bmi: number;
  targetWeightKg?: number;
  activityLevel: string;
  fitnessGoal: string;
}

export interface MealDraftRequest {
  health: GenerationHealthInput & Record<string, unknown>;
  preferences: NutritionPreferences;
}

export interface MealSlot {
  mealType: string;
  time: string;
  goal: string;
}

export interface MealSelection {
  mealType: string;
  time: string;
  recipeId: string;
  servings: number;
  reason: string;
}

export interface GenerationTraceEntry {
  name: NutritionPromptName;
  previousStep: NutritionPromptName | null;
  source: "local" | "deepseek" | "backend_function";
  settings: NutritionModelSettings;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  toolResult?: NutritionFunctionResult;
}

export interface MealDraftResult {
  source: "local" | "deepseek" | "cache";
  fallbackReason: NutritionGenerationErrorCode | null;
  generatedAt: string;
  model: string | null;
  assessment: Record<string, unknown>;
  structure: { meals: MealSlot[] };
  selections: MealSelection[];
  nutrition: NutritionFunctionResult;
  review: Record<string, unknown>;
  correction: Record<string, unknown>;
  retrieval: RecipeRetrievalContext;
  trace: GenerationTraceEntry[];
}

export interface MealDraftOptions {
  provider?: NutritionProvider | null;
  cache?: GenerationCache<MealDraftResult>;
  now?: () => Date;
  userId?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformedResponse(message: string): NutritionGenerationError {
  return new NutritionGenerationError("malformed_response", message, 502, true);
}

function requiredText(value: unknown, field: string, maximumLength = 500): string {
  if (typeof value !== "string") {
    throw malformedResponse(`${field} must be text.`);
  }
  const clean = value.trim();
  if (clean.length === 0 || clean.length > maximumLength) {
    throw malformedResponse(`${field} has an invalid length.`);
  }
  return clean;
}

function requiredTextList(value: unknown, field: string, maximumItems = 12, maximumLength = 100): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw malformedResponse(`${field} must be a short list.`);
  }
  return value.map((item, index) => requiredText(item, `${field} item ${index + 1}`, maximumLength));
}

function boundedNumber(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new NutritionGenerationError("invalid_parameters", `${field} is outside the supported range.`, 400, false);
  }
  return value;
}

function safeHealth(value: unknown): GenerationHealthInput {
  if (!isRecord(value)) {
    throw new NutritionGenerationError("invalid_parameters", "Saved health data is required.", 400, false);
  }
  const activityLevel = value.activityLevel;
  const fitnessGoal = value.fitnessGoal;
  if (typeof activityLevel !== "string" || !activityLevels.includes(activityLevel as never)) {
    throw new NutritionGenerationError("invalid_parameters", "Activity level is not supported.", 400, false);
  }
  if (typeof fitnessGoal !== "string" || !fitnessGoals.includes(fitnessGoal as never)) {
    throw new NutritionGenerationError("invalid_parameters", "Fitness goal is not supported.", 400, false);
  }
  return {
    bmi: boundedNumber(value.bmi, "BMI", 10, 80),
    ...(value.targetWeightKg === undefined
      ? {}
      : { targetWeightKg: boundedNumber(value.targetWeightKg, "Target weight", 20, 500) }),
    activityLevel,
    fitnessGoal,
  };
}

function generationCacheKey(health: GenerationHealthInput, preferences: NutritionPreferences): string {
  const input = JSON.stringify({
    health: {
      bmi: health.bmi,
      targetWeightKg: health.targetWeightKg ?? null,
      activityLevel: health.activityLevel,
      fitnessGoal: health.fitnessGoal,
    },
    preferences,
  });
  return `meal-draft:${createHash("sha256").update(input).digest("hex")}`;
}

function isProviderFallbackError(error: unknown): error is NutritionGenerationError {
  return error instanceof NutritionGenerationError && [
    "provider_rejected",
    "rate_limited",
    "timed_out",
    "network_error",
    "malformed_response",
  ].includes(error.code);
}

function localAssessment(health: GenerationHealthInput, preferences: NutritionPreferences): Record<string, unknown> {
  const priorities = [
    `${preferences.calorieTargetKcal} kcal daily target`,
    `${preferences.macroTargets.proteinG} g protein target`,
    "saved food restrictions",
  ];
  return {
    strategy: `Use ${preferences.mealsPerDay} meals and ${preferences.snacksPerDay} snacks at the saved times.`,
    priorities,
    health: {
      bmi: health.bmi,
      targetWeightKg: health.targetWeightKg ?? null,
      activityLevel: health.activityLevel,
      fitnessGoal: health.fitnessGoal,
    },
  };
}

function mealTypes(count: number): string[] {
  if (count === 1) return ["meal"];
  if (count === 2) return ["breakfast", "dinner"];
  const result = ["breakfast", "lunch", "dinner"];
  for (let index = result.length; index < count; index += 1) {
    result.push(`meal_${index + 1}`);
  }
  return result;
}

function localStructure(preferences: NutritionPreferences): { meals: MealSlot[] } {
  const meals = mealTypes(preferences.mealsPerDay).map((mealType, index) => ({
    mealType,
    time: preferences.mealTimes[index],
    goal: `Support the saved daily targets during ${mealType}.`,
  }));
  const snackTimes = ["10:30", "16:00", "21:00", "11:30", "17:30"];
  for (let index = 0; index < preferences.snacksPerDay; index += 1) {
    meals.push({
      mealType: `snack_${index + 1}`,
      time: snackTimes[index],
      goal: "Add a smaller option that keeps the saved restrictions.",
    });
  }
  return { meals: meals.sort((first, second) => first.time.localeCompare(second.time)) };
}

function planningContext(preferences: NutritionPreferences): Record<string, unknown> {
  return {
    calorieTargetKcal: preferences.calorieTargetKcal,
    macroTargets: preferences.macroTargets,
    dietaryPreferences: preferences.dietaryPreferences,
    requiredDietaryTags: restrictiveDietaryTags(preferences.dietaryPreferences),
    preferredDietaryStyles: dietaryStylePreferences(preferences.dietaryPreferences),
    allergies: preferences.allergies,
    dislikedIngredients: preferences.dislikedIngredients,
    cuisinePreferences: preferences.cuisinePreferences,
    mealSchedule: localStructure(preferences).meals.map(({ mealType, time }) => ({ mealType, time })),
    timezone: preferences.timezone,
  };
}

function retrievalFor(preferences: NutritionPreferences, userId?: number): RecipeRetrievalContext {
  const dietaryTags = restrictiveDietaryTags(preferences.dietaryPreferences);
  const plannedItems = Math.max(1, preferences.mealsPerDay + preferences.snacksPerDay);
  const targetPerItem = preferences.calorieTargetKcal / plannedItems;
  const query = [
    ...preferences.cuisinePreferences,
    ...preferences.dietaryPreferences,
  ].join(" ");
  const filters = {
    dietaryTags,
    allergies: preferences.allergies,
    excludedIngredients: preferences.dislikedIngredients,
    maxCaloriesKcal: targetPerItem * 4,
    limit: 10,
  };
  const preferred = buildRecipeRetrievalContext(query, filters, { userId, planning: true });
  if (preferred.retrievedRecipes.length > 0) {
    return preferred;
  }
  const broad = buildRecipeRetrievalContext("", filters, { userId, planning: true });
  if (broad.retrievedRecipes.length === 0) {
    throw new NutritionGenerationError(
      "missing_ingredient",
      "No local recipe matches the saved food restrictions.",
      404,
      true,
    );
  }
  return broad;
}

function roundedServings(targetCalories: number, recipeCalories: number): number {
  const ratio = targetCalories / Math.max(recipeCalories, 1);
  return Math.min(4, Math.max(0.25, Math.round(ratio * 100) / 100));
}

function localSelections(
  structure: { meals: MealSlot[] },
  retrieval: RecipeRetrievalContext,
  preferences: NutritionPreferences,
): MealSelection[] {
  const targetPerMeal = preferences.calorieTargetKcal / structure.meals.length;
  return structure.meals.map((slot, index) => {
    const candidate = retrieval.retrievedRecipes[index % retrieval.retrievedRecipes.length];
    return {
      mealType: slot.mealType,
      time: slot.time,
      recipeId: candidate.recipe.id,
      servings: roundedServings(targetPerMeal, candidate.nutrition.caloriesKcal),
      reason: "Selected from the local relevance results and checked against saved restrictions.",
    };
  });
}

function onlineAssessment(value: Record<string, unknown>): Record<string, unknown> {
  return {
    strategy: requiredText(value.strategy, "Assessment strategy"),
    priorities: requiredTextList(value.priorities, "Assessment priorities"),
  };
}

function onlineStructure(value: Record<string, unknown>, preferences: NutritionPreferences): { meals: MealSlot[] } {
  const schedule = localStructure(preferences);
  if (!Array.isArray(value.meals) || value.meals.length !== schedule.meals.length) {
    throw malformedResponse("Meal structure must contain the requested number of meals and snacks.");
  }
  const seenTypes = new Set<string>();
  const meals = value.meals.map((item, index) => {
    if (!isRecord(item)) {
      throw malformedResponse(`Meal ${index + 1} must be one object.`);
    }
    const mealType = requiredText(item.mealType, `Meal ${index + 1} type`, 50);
    const time = requiredText(item.time, `Meal ${index + 1} time`, 5);
    const goal = requiredText(item.goal, `Meal ${index + 1} goal`, 300);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(time)) {
      throw malformedResponse(`Meal ${index + 1} time must use HH:mm format.`);
    }
    if (seenTypes.has(mealType)) {
      throw malformedResponse("Meal types must be unique.");
    }
    if (!schedule.meals.some((slot) => slot.mealType === mealType
      && (slot.mealType.startsWith("snack_") || slot.time === time))) {
      throw malformedResponse("Meal structure must keep the saved meal schedule.");
    }
    seenTypes.add(mealType);
    return { mealType, time, goal };
  });
  return { meals: meals.sort((first, second) => first.time.localeCompare(second.time)) };
}

function onlineSelections(
  value: Record<string, unknown>,
  structure: { meals: MealSlot[] },
  retrieval: RecipeRetrievalContext,
): MealSelection[] {
  if (!Array.isArray(value.selections) || value.selections.length !== structure.meals.length) {
    throw malformedResponse("Recipe selections must match the meal structure.");
  }
  const allowedRecipeIds = new Set(retrieval.retrievedRecipes.map((item) => item.recipe.id));
  return value.selections.map((item, index) => {
    if (!isRecord(item)) {
      throw malformedResponse(`Recipe selection ${index + 1} must be one object.`);
    }
    const slot = structure.meals[index];
    const mealType = requiredText(item.mealType, `Recipe selection ${index + 1} type`, 50);
    const time = requiredText(item.time, `Recipe selection ${index + 1} time`, 5);
    const recipeId = requiredText(item.recipeId, `Recipe selection ${index + 1} recipe`, 100);
    const servings = boundedNumber(item.servings, `Recipe selection ${index + 1} servings`, 0.25, 4);
    const reason = requiredText(item.reason, `Recipe selection ${index + 1} reason`, 500);
    if (mealType !== slot.mealType || time !== slot.time) {
      throw malformedResponse("Recipe selections must keep the supplied meal types and times.");
    }
    if (!allowedRecipeIds.has(recipeId)) {
      throw malformedResponse("Recipe selections must use the supplied retrieval results.");
    }
    return { mealType, time, recipeId, servings, reason };
  });
}

function onlineReview(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.needsCorrection !== "boolean") {
    throw malformedResponse("Nutrition review needsCorrection must be true or false.");
  }
  return {
    status: requiredText(value.status, "Nutrition review status", 50),
    gaps: requiredTextList(value.gaps, "Nutrition review gaps"),
    excesses: requiredTextList(value.excesses, "Nutrition review excesses"),
    needsCorrection: value.needsCorrection,
    summary: requiredText(value.summary, "Nutrition review summary", 500),
  };
}

function onlineCorrection(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.required !== "boolean" || value.keepsSavedPreferences !== true) {
    throw malformedResponse("Plan correction must keep the saved preferences.");
  }
  return {
    required: value.required,
    action: requiredText(value.action, "Plan correction action", 100),
    reasons: requiredTextList(value.reasons, "Plan correction reasons", 12, 500),
    keepsSavedPreferences: true,
  };
}

function executeReviewFunction(
  calls: NutritionFunctionCall[],
  selections: MealSelection[],
): NutritionFunctionResult {
  if (calls.length !== 1) {
    throw malformedResponse("Nutrition review must request one backend nutrition function.");
  }
  const call = calls[0];
  if (call.name !== "calculate_day_nutrition" || !isRecord(call.arguments)) {
    throw new NutritionGenerationError(
      "invalid_parameters",
      "Nutrition review must request the daily nutrition calculation.",
      400,
      false,
    );
  }
  const meals = call.arguments.meals;
  if (!Array.isArray(meals) || meals.length !== selections.length) {
    throw new NutritionGenerationError(
      "invalid_parameters",
      "Nutrition function meals must match the recipe selections.",
      400,
      false,
    );
  }
  meals.forEach((meal, index) => {
    const selection = selections[index];
    if (!isRecord(meal) || meal.recipeId !== selection.recipeId || meal.servings !== selection.servings) {
      throw new NutritionGenerationError(
        "invalid_parameters",
        "Nutrition function meals must match the recipe selections.",
        400,
        false,
      );
    }
  });
  return executeNutritionFunction(call);
}

function traceEntry(
  name: NutritionPromptName,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  previous?: GenerationTraceEntry,
  toolResult?: NutritionFunctionResult,
): GenerationTraceEntry {
  const prompt = buildNutritionPrompt(
    name,
    input,
    previous ? { step: previous.name, output: previous.output } : undefined,
  );
  const finalMessage = prompt.messages[prompt.messages.length - 1];
  return {
    name,
    previousStep: prompt.previousStep,
    source: toolResult ? "backend_function" : "local",
    settings: prompt.settings,
    input: JSON.parse(finalMessage.content) as Record<string, unknown>,
    output,
    ...(toolResult ? { toolResult } : {}),
  };
}

function onlineTraceEntry(
  prompt: NutritionPromptRequest,
  output: Record<string, unknown>,
  toolResult?: NutritionFunctionResult,
): GenerationTraceEntry {
  const finalMessage = prompt.messages[prompt.messages.length - 1];
  return {
    name: prompt.name as NutritionPromptName,
    previousStep: prompt.previousStep,
    source: toolResult ? "backend_function" : "deepseek",
    settings: prompt.settings,
    input: JSON.parse(finalMessage.content) as Record<string, unknown>,
    output,
    ...(toolResult ? { toolResult } : {}),
  };
}

async function generateOnlineDraft(
  provider: NutritionProvider,
  health: GenerationHealthInput,
  preferences: NutritionPreferences,
  retrieval: RecipeRetrievalContext,
  now: Date,
): Promise<MealDraftResult> {
  const trace: GenerationTraceEntry[] = [];
  const context = planningContext(preferences);

  const assessmentPrompt = buildNutritionPrompt("profile_assessment", { health, preferences, context });
  const assessmentCompletion = await provider.complete(assessmentPrompt);
  const assessment = onlineAssessment(assessmentCompletion.content);
  trace.push(onlineTraceEntry(assessmentPrompt, assessment));

  const structurePrompt = buildNutritionPrompt("meal_structure", {
    context,
    mealsPerDay: preferences.mealsPerDay,
    snacksPerDay: preferences.snacksPerDay,
    mealTimes: preferences.mealTimes,
    timezone: preferences.timezone,
  }, { step: "profile_assessment", output: assessment });
  const structureCompletion = await provider.complete(structurePrompt);
  const structure = onlineStructure(
    structureCompletion.content,
    preferences,
  );
  trace.push(onlineTraceEntry(structurePrompt, structure));

  const recipePrompt = buildNutritionPrompt("recipe_generation", {
    context,
    structure,
    retrievedRecipeIds: retrieval.retrievedRecipes.map((item) => item.recipe.id),
    augmentedPrompt: retrieval.augmentedPrompt,
  }, { step: "meal_structure", output: structure });
  const recipeCompletion = await provider.complete(recipePrompt);
  const selections = onlineSelections(recipeCompletion.content, structure, retrieval);
  const recipeOutput = {
    selections,
    retrievedRecipeIds: retrieval.retrievedRecipes.map((item) => item.recipe.id),
    augmentedPrompt: retrieval.augmentedPrompt,
  };
  trace.push(onlineTraceEntry(recipePrompt, recipeOutput));

  const functionPrompt = buildNutritionPrompt("nutrition_review", {
    context,
    selections,
    requiredFunction: "calculate_day_nutrition",
  }, { step: "recipe_generation", output: recipeOutput });
  const functionCompletion = await provider.complete(functionPrompt, nutritionFunctionDefinitions);
  const nutrition = executeReviewFunction(functionCompletion.toolCalls, selections);

  const reviewPrompt = buildNutritionPrompt("nutrition_review", {
    context,
    selections,
    functionName: nutrition.functionName,
    calculatedNutrition: nutrition.value,
  }, { step: "recipe_generation", output: recipeOutput });
  const reviewCompletion = await provider.complete(reviewPrompt);
  if (reviewCompletion.toolCalls.length > 0) {
    throw malformedResponse("Nutrition review returned an unexpected extra function call.");
  }
  onlineReview(reviewCompletion.content);
  const review = reviewNutrition(nutrition.value.nutrition as NutritionValues, preferences);
  trace.push(onlineTraceEntry(reviewPrompt, review, nutrition));

  const correctionPrompt = buildNutritionPrompt("plan_correction", {
    context,
    selections,
    retrievedRecipeIds: retrieval.retrievedRecipes.map((item) => item.recipe.id),
    review,
    calculatedNutrition: nutrition.value,
    dietaryPreferences: preferences.dietaryPreferences,
    allergies: preferences.allergies,
    dislikedIngredients: preferences.dislikedIngredients,
  }, { step: "nutrition_review", output: review });
  const correctionCompletion = await provider.complete(correctionPrompt);
  onlineCorrection(correctionCompletion.content);
  const corrected = correctMealSelections(selections, preferences, retrieval);
  const correction = corrected.correction;
  trace.push(onlineTraceEntry(correctionPrompt, correction, corrected.nutrition));

  return {
    source: "deepseek",
    fallbackReason: null,
    generatedAt: now.toISOString(),
    model: correctionCompletion.model,
    assessment,
    structure,
    selections: corrected.selections,
    nutrition: corrected.nutrition,
    review: corrected.review,
    correction,
    retrieval,
    trace,
  };
}

export async function generateMealDraft(
  request: MealDraftRequest,
  options: MealDraftOptions = {},
): Promise<MealDraftResult> {
  const now = options.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new NutritionGenerationError("invalid_parameters", "Generation time is invalid.", 400, false);
  }
  const health = safeHealth(request.health);
  const preferences = parseNutritionPreferences(request.preferences, now);
  const retrieval = retrievalFor(preferences, options.userId);
  let fallbackReason: NutritionGenerationErrorCode = "not_configured";
  if (options.provider) {
    const cacheKey = generationCacheKey(health, preferences);
    try {
      const online = await generateOnlineDraft(options.provider, health, preferences, retrieval, now);
      options.cache?.set(cacheKey, online);
      return online;
    } catch (error) {
      if (!isProviderFallbackError(error)) {
        throw error;
      }
      fallbackReason = error.code;
      const cached = options.cache?.get(cacheKey);
      if (cached && cached.selections.every(selection => retrieval.retrievedRecipes.some(item => item.recipe.id === selection.recipeId))) {
        return {
          ...cached,
          source: "cache",
          fallbackReason,
        };
      }
    }
  }
  const assessment = localAssessment(health, preferences);
  const structure = localStructure(preferences);
  const selections = localSelections(structure, retrieval, preferences);
  const recipeOutput = {
    selections,
    retrievedRecipeIds: retrieval.retrievedRecipes.map((item) => item.recipe.id),
    augmentedPrompt: retrieval.augmentedPrompt,
  };
  const nutrition = executeNutritionFunction({
    name: "calculate_day_nutrition",
    arguments: {
      meals: selections.map((selection) => ({
        recipeId: selection.recipeId,
        servings: selection.servings,
      })),
    },
  });
  const review = reviewNutrition(nutrition.value.nutrition as NutritionValues, preferences);
  const corrected = correctMealSelections(selections, preferences, retrieval);
  const correction = corrected.correction;
  const context = planningContext(preferences);

  const trace: GenerationTraceEntry[] = [];
  trace.push(traceEntry("profile_assessment", { health, preferences, context }, assessment));
  trace.push(traceEntry("meal_structure", {
    context,
    mealsPerDay: preferences.mealsPerDay,
    snacksPerDay: preferences.snacksPerDay,
    mealTimes: preferences.mealTimes,
    timezone: preferences.timezone,
  }, structure, trace.at(-1)));
  trace.push(traceEntry("recipe_generation", {
    context,
    structure,
    retrievedRecipeIds: retrieval.retrievedRecipes.map((item) => item.recipe.id),
    augmentedPrompt: retrieval.augmentedPrompt,
  }, recipeOutput, trace.at(-1)));
  trace.push(traceEntry("nutrition_review", {
    context,
    selections,
    calculatedNutrition: nutrition.value,
  }, review, trace.at(-1), nutrition));
  trace.push(traceEntry("plan_correction", {
    context,
    selections,
    calculatedNutrition: nutrition.value,
    review,
    dietaryPreferences: preferences.dietaryPreferences,
    allergies: preferences.allergies,
    dislikedIngredients: preferences.dislikedIngredients,
  }, correction, trace.at(-1), corrected.nutrition));

  return {
    source: "local",
    fallbackReason,
    generatedAt: now.toISOString(),
    model: null,
    assessment,
    structure,
    selections: corrected.selections,
    nutrition: corrected.nutrition,
    review: corrected.review,
    correction,
    retrieval,
    trace,
  };
}
