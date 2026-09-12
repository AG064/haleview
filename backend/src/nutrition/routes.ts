import express, { type Request, type Response } from "express";
import { AuthError, authMiddleware } from "../auth.js";
import { accountAccess, guardNutritionProvider } from "../online-access.js";
import { getPrivacy, getProfile } from "../storage.js";
import { CatalogValidationError, getCatalogStats, getRecipe, getRecipeEnhancedNutrition, recipeMeetsFoodRestrictions, searchIngredients } from "./catalog.js";
import { deriveNutritionDefaults, parseNutritionPreferences } from "./preferences.js";
import { getNutritionPreferenceHistory, getNutritionPreferences, saveNutritionPreferences } from "./storage.js";
import { NutritionValidationError } from "./units.js";
import { NutritionGenerationError } from "./errors.js";
import { restrictiveDietaryTags } from "./dietary-policy.js";
import { buildNutritionProgress, buildNutritionSummary } from "./analysis.js";
import {
  createManualIntake,
  createPlanMealIntake,
  deleteIntakeRecord,
  IntakeValidationError,
  listIntakeRecords,
  saveIntakeRecord,
} from "./intake.js";
import {
  listNutritionFeedback,
  NutritionFeedbackError,
  saveNutritionFeedback,
  summariseNutritionFeedback,
  type FeedbackDecision,
  type FeedbackRating,
  type FeedbackSubject,
} from "./feedback.js";
import { buildRecipeRetrievalContext } from "./rag.js";
import { communityRecipeOverview, searchRecipesWithCommunity, searchRecipePageWithCommunity } from "./community-rag.js";
import { executeNutritionFunction } from "./function-calling.js";
import {
  CustomRecipeError,
  generateCustomRecipe,
  getIngredientSubstitutions,
  scaleCustomRecipe,
  type CustomRecipeSubstitutionInput,
} from "./custom-recipes.js";
import { GenerationCache } from "./cache.js";
import type { MealDraftResult } from "./generation.js";
import { createDeepSeekNutritionProviderFromEnv } from "./provider.js";
import {
  addManualMeal,
  findMealAlternatives,
  generateMealPlan,
  moveMeal,
  PlanValidationError,
  replaceMealWithRecipe,
  type MealPlan,
  type PlannedMeal,
} from "./meal-plans.js";
import {
  getMealPlan,
  getMealPlanVersions,
  listMealPlans,
  MealPlanStorageError,
  restoreMealPlanVersion,
  saveMealPlan,
} from "./meal-plan-storage.js";
import {
  createShoppingList,
  getShoppingList,
  listShoppingLists,
  saveShoppingList,
  ShoppingListValidationError,
  updateShoppingListItem,
} from "./shopping-list.js";
import type { SearchFilters, NutritionValues, NutritionPreferences } from "./types.js";
import { generateRecipeCreation, listRecipeCreations, getRecipeCreation, saveRecipeCreation, deleteRecipeCreation, scaleRecipeCreation } from "./recipe-creations.js";
import { addCreatedMeal } from "./meal-plans.js";
import { searchRecipeGroups } from "./recipe-groups.js";
import { addRecipeFavourite, listRecipeFavourites, removeRecipeFavourite } from "./favourites.js";

const mealGenerationCache = new GenerationCache<MealDraftResult>({ maxEntries: 50, ttlMs: 15 * 60 * 1000 });

function requestProvider(request: Request, userId: number) {
  const access = accountAccess(userId, request.headers.authorization);
  access.check();
  const privacy = getPrivacy(userId);
  return guardNutritionProvider(privacy?.dataForRecommendations ? createDeepSeekNutritionProviderFromEnv() : null, access.checkOnline);
}

function authUserId(request: Request): number {
  const userId = (request as { authUserId?: number }).authUserId;
  if (!userId) {
    throw new AuthError(401, "Sign in is required.");
  }
  return userId;
}

function oneQueryValue(request: Request, key: string): string | undefined {
  const value = request.query[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new NutritionValidationError(`${key} must be a single value.`);
  }
  const clean = value.trim();
  return clean || undefined;
}

function listQueryValue(request: Request, key: string): string[] | undefined {
  const value = oneQueryValue(request, key);
  if (value === undefined) return undefined;
  const result = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (result.length > 20 || result.some((item) => item.length > 80)) {
    throw new NutritionValidationError(`${key} contains too many or too-long values.`);
  }
  return [...new Set(result)];
}

function numberQueryValue(request: Request, key: string, minimum: number, maximum: number): number | undefined {
  const value = oneQueryValue(request, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new NutritionValidationError(`${key} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function searchFilters(request: Request): SearchFilters {
  return {
    query: oneQueryValue(request, "query"),
    cuisine: oneQueryValue(request, "cuisine"),
    meal: oneQueryValue(request, "meal"),
    dietaryTags: listQueryValue(request, "dietaryTags"),
    allergies: listQueryValue(request, "allergies"),
    excludedIngredients: listQueryValue(request, "excludedIngredients"),
    maxCaloriesKcal: numberQueryValue(request, "maxCaloriesKcal", 1, 10000),
    maxProteinG: numberQueryValue(request, "maxProteinG", 0, 1000),
    maxCarbsG: numberQueryValue(request, "maxCarbsG", 0, 2000),
    maxFatsG: numberQueryValue(request, "maxFatsG", 0, 1000),
    minFiberG: numberQueryValue(request, "minFiberG", 0, 1000),
    maxSodiumMg: numberQueryValue(request, "maxSodiumMg", 0, 100000),
    minVitaminDMcg: numberQueryValue(request, "minVitaminDMcg", 0, 10000),
    minVitaminB12Mcg: numberQueryValue(request, "minVitaminB12Mcg", 0, 10000),
    minIronMg: numberQueryValue(request, "minIronMg", 0, 10000),
    minCalciumMg: numberQueryValue(request, "minCalciumMg", 0, 100000),
    minMagnesiumMg: numberQueryValue(request, "minMagnesiumMg", 0, 100000),
    maxTimeMinutes: numberQueryValue(request, "maxTimeMinutes", 1, 1440),
    limit: numberQueryValue(request, "limit", 1, 50),
    offset: numberQueryValue(request, "offset", 0, 10000)
  };
}

function sendNutritionError(error: unknown, response: Response, fallback: string): void {
  if (error instanceof NutritionGenerationError) {
    response.status(error.status).json({ error: error.message, code: error.code, recoverable: error.recoverable });
    return;
  }
  if (error instanceof AuthError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof NutritionValidationError || error instanceof CatalogValidationError || error instanceof PlanValidationError || error instanceof MealPlanStorageError || error instanceof ShoppingListValidationError || error instanceof IntakeValidationError || error instanceof NutritionFeedbackError || error instanceof CustomRecipeError) {
    response.status("status" in error && typeof error.status === "number" ? error.status : 400).json({ error: error.message });
    return;
  }
  console.warn(`Nutrition request failed: ${fallback}`);
  response.status(500).json({ error: fallback });
}

function objectBody(request: Request): Record<string, unknown> {
  if (typeof request.body !== "object" || request.body === null || Array.isArray(request.body)) {
    throw new NutritionValidationError("Request data must be an object.");
  }
  return request.body as Record<string, unknown>;
}

function savedPreferences(userId: number): NutritionPreferences {
  const profile = getProfile(userId);
  if (!profile) throw new PlanValidationError("Save a profile before using meal plans.");
  return getNutritionPreferences(userId) ?? deriveNutritionDefaults(profile);
}

function healthForPlan(userId: number) {
  const profile = getProfile(userId);
  if (!profile) throw new PlanValidationError("Save a profile before using meal plans.");
  return {
    bmi: profile.analytics.bmi,
    ...(profile.targetWeightKg === undefined ? {} : { targetWeightKg: profile.targetWeightKg }),
    activityLevel: profile.activityLevel,
    fitnessGoal: profile.fitnessGoal,
  };
}

function paramValue(request: Request, key: string): string {
  const value = request.params[key];
  if (typeof value !== "string" || !value.trim()) throw new NutritionValidationError(`${key} is required.`);
  return value;
}

function planDuration(value: unknown): "day" | "week" {
  if (value !== "day" && value !== "week") throw new PlanValidationError("Plan duration must be day or week.");
  return value;
}

function startDateValue(value: unknown): string {
  if (value === undefined) return new Date().toISOString().slice(0, 10);
  if (typeof value !== "string") throw new PlanValidationError("Start date must use YYYY-MM-DD format.");
  return value;
}

function mealFromPlan(plan: MealPlan, mealId: string): PlannedMeal {
  const meal = plan.days.flatMap((day) => day.meals).find((item) => item.id === mealId);
  if (!meal) throw new PlanValidationError("The selected meal was not found.");
  return meal;
}

function manualNutrition(value: unknown): NutritionValues {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlanValidationError("Manual meal nutrition is required.");
  }
  const input = value as Record<string, unknown>;
  const result: NutritionValues = {
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
  for (const key of Object.keys(result) as Array<keyof NutritionValues>) {
    const current = input[key];
    if (current !== undefined) {
      if (typeof current !== "number" || !Number.isFinite(current) || current < 0 || current > 1000000) {
        throw new PlanValidationError(`${key} must be a non-negative number.`);
      }
      result[key] = current;
    }
  }
  if (result.caloriesKcal <= 0) throw new PlanValidationError("Manual meal calories must be greater than zero.");
  return result;
}

export function createNutritionRouter(): express.Router {
  const router = express.Router();

  router.get("/favourites", authMiddleware, (request, response) => {
    try { response.json({ recipes: listRecipeFavourites(authUserId(request)) }); }
    catch (error) { sendNutritionError(error, response, "Favourites could not be loaded."); }
  });
  router.put("/favourites/:id", authMiddleware, (request, response) => {
    try { response.json(addRecipeFavourite(authUserId(request), paramValue(request, "id"))); }
    catch (error) { sendNutritionError(error, response, "The favourite could not be saved."); }
  });
  router.delete("/favourites/:id", authMiddleware, (request, response) => {
    try {
      removeRecipeFavourite(authUserId(request), paramValue(request, "id"));
      response.json({ message: "Removed from Favourites." });
    } catch (error) { sendNutritionError(error, response, "The favourite could not be removed."); }
  });

  router.get("/creations", authMiddleware, (request, response) => {
    try { response.json({ recipes: listRecipeCreations(authUserId(request)) }); }
    catch (error) { sendNutritionError(error, response, "Your recipes could not be loaded."); }
  });
  router.get("/creations/sources", authMiddleware, (request, response) => {
    try {
      const preferences = savedPreferences(authUserId(request));
      response.json({ recipes: searchRecipesWithCommunity({ query: oneQueryValue(request, "query"), limit: 12,
        dietaryTags: restrictiveDietaryTags(preferences.dietaryPreferences), allergies: preferences.allergies,
        excludedIngredients: preferences.dislikedIngredients }) });
    } catch (error) { sendNutritionError(error, response, "Source recipes could not be loaded."); }
  });
  router.post("/creations", authMiddleware, async (request, response) => {
    try {
      const userId = authUserId(request);
      const result = await generateRecipeCreation(objectBody(request), { userId, preferences: savedPreferences(userId), provider: requestProvider(request, userId) });
      accountAccess(userId, request.headers.authorization).check();
      response.status(201).json(result);
    } catch (error) { sendNutritionError(error, response, "The recipe could not be created. Try again shortly."); }
  });
  router.get("/creations/:id", authMiddleware, (request, response) => {
    try {
      const result = getRecipeCreation(authUserId(request), paramValue(request, "id"));
      if (!result) throw new CustomRecipeError("Created recipe not found.", 404);
      response.json(result);
    } catch (error) { sendNutritionError(error, response, "The recipe could not be loaded."); }
  });
  router.post("/creations/:id/save", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      response.json(saveRecipeCreation(userId, paramValue(request, "id"), objectBody(request).servings, savedPreferences(userId)));
    }
    catch (error) { sendNutritionError(error, response, "The recipe could not be saved."); }
  });
  router.delete("/creations/:id", authMiddleware, (request, response) => {
    try {
      deleteRecipeCreation(authUserId(request), paramValue(request, "id"));
      removeRecipeFavourite(authUserId(request), paramValue(request, "id"));
      response.json({ message: "Recipe removed. Copies already in a plan are kept." });
    } catch (error) { sendNutritionError(error, response, "The recipe could not be removed."); }
  });
  router.post("/creations/:id/scale", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      response.json(scaleRecipeCreation(userId, paramValue(request, "id"), objectBody(request).servings, savedPreferences(userId)));
    } catch (error) { sendNutritionError(error, response, "The servings could not be updated."); }
  });
  router.post("/plans/:planId/creations", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      const body = objectBody(request);
      const plan = getMealPlan(userId, paramValue(request, "planId"));
      if (!plan) throw new CustomRecipeError("Meal plan not found.", 404);
      if (typeof body.recipeId !== "string" || typeof body.date !== "string" || typeof body.time !== "string" || typeof body.mealType !== "string") {
        throw new CustomRecipeError("Choose a recipe, plan date, meal and time.");
      }
      const creation = scaleRecipeCreation(userId, body.recipeId, body.servings, savedPreferences(userId));
      response.json({ plan: saveMealPlan(userId, addCreatedMeal(plan, creation.recipe, {
        date: body.date, time: body.time, mealType: body.mealType,
      }), "Added created recipe") });
    } catch (error) { sendNutritionError(error, response, "The recipe could not be added to the plan."); }
  });

  router.get("/preferences", authMiddleware, (request, response) => {
    try {
      response.json({ preferences: getNutritionPreferences(authUserId(request)) });
    } catch (error) {
      sendNutritionError(error, response, "Nutrition preferences could not be read.");
    }
  });

  router.get("/defaults", authMiddleware, (request, response) => {
    try {
      const profile = getProfile(authUserId(request));
      if (!profile) {
        response.status(404).json({ error: "Save a profile before using nutrition defaults." });
        return;
      }
      response.json({ preferences: deriveNutritionDefaults(profile) });
    } catch (error) {
      sendNutritionError(error, response, "Nutrition defaults could not be created.");
    }
  });

  router.put("/preferences", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      const current = getNutritionPreferences(userId);
      const profile = getProfile(userId);
      const baseline = current ?? (profile ? deriveNutritionDefaults(profile) : parseNutritionPreferences({}));
      const preferences = saveNutritionPreferences(userId, { ...baseline, ...objectBody(request) });
      response.json({ preferences });
    } catch (error) {
      sendNutritionError(error, response, "Nutrition preferences could not be saved.");
    }
  });

  router.get("/preferences/history", authMiddleware, (request, response) => {
    try {
      const limit = numberQueryValue(request, "limit", 1, 50) ?? 20;
      response.json({ history: getNutritionPreferenceHistory(authUserId(request), limit) });
    } catch (error) {
      sendNutritionError(error, response, "Nutrition preference history could not be read.");
    }
  });

  router.get("/intake", authMiddleware, (request, response) => {
    try {
      const records = listIntakeRecords(authUserId(request), {
        fromDate: oneQueryValue(request, "fromDate"),
        toDate: oneQueryValue(request, "toDate"),
        limit: numberQueryValue(request, "limit", 1, 1000),
      });
      response.json({ records });
    } catch (error) {
      sendNutritionError(error, response, "Nutrition intake could not be read.");
    }
  });

  router.post("/intake", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      const body = objectBody(request);
      if (typeof body.date !== "string" || typeof body.title !== "string") {
        throw new IntakeValidationError("Nutrition intake needs a date and title.");
      }
      const record = createManualIntake({
        date: body.date,
        title: body.title,
        nutrition: manualNutrition(body.nutrition),
      });
      response.status(201).json({ record: saveIntakeRecord(userId, record) });
    } catch (error) {
      sendNutritionError(error, response, "Nutrition intake could not be saved.");
    }
  });

  router.post("/intake/from-plan", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      const body = objectBody(request);
      if (typeof body.planId !== "string" || typeof body.mealId !== "string") {
        throw new IntakeValidationError("A plan id and meal id are required.");
      }
      const plan = getMealPlan(userId, body.planId);
      if (!plan) {
        response.status(404).json({ error: "Meal plan not found." });
        return;
      }
      const record = createPlanMealIntake(plan, body.mealId);
      response.status(201).json({ record: saveIntakeRecord(userId, record) });
    } catch (error) {
      sendNutritionError(error, response, "The planned meal could not be recorded.");
    }
  });

  router.delete("/intake/:recordId", authMiddleware, (request, response) => {
    try {
      if (!deleteIntakeRecord(authUserId(request), paramValue(request, "recordId"))) {
        response.status(404).json({ error: "Nutrition intake not found." });
        return;
      }
      response.json({ message: "Nutrition intake removed." });
    } catch (error) {
      sendNutritionError(error, response, "Nutrition intake could not be removed.");
    }
  });

  router.get("/progress", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      const profile = getProfile(userId);
      if (!profile) {
        response.status(404).json({ error: "Save a profile before viewing nutrition progress." });
        return;
      }
      const preferences = getNutritionPreferences(userId) ?? deriveNutritionDefaults(profile);
      const progress = buildNutritionProgress({
        profile,
        preferences,
        records: listIntakeRecords(userId, { limit: 1000 }),
      });
      response.json({ progress });
    } catch (error) {
      sendNutritionError(error, response, "Nutrition progress could not be created.");
    }
  });

  router.post("/review", authMiddleware, async (request, response) => {
    try {
      const userId = authUserId(request);
      const profile = getProfile(userId);
      if (!profile) {
        response.status(404).json({ error: "Save a profile before reviewing nutrition." });
        return;
      }
      const preferences = savedPreferences(userId);
      const privacy = getPrivacy(userId);
      const onlineAllowed = privacy?.consentGiven === true && privacy.dataForRecommendations === true;
      const progress = buildNutritionProgress({ profile, preferences, records: listIntakeRecords(userId, { limit: 1000 }) });
      const summary = await buildNutritionSummary(progress, profile, preferences, { provider: requestProvider(request, userId) });
      accountAccess(userId, request.headers.authorization).check();
      response.json({ summary, progress, message: progress.today.recordCount === 0 ? "Record a meal before requesting an online nutrition review." : summary.source === "local"
        ? onlineAllowed ? "Online nutrition review could not complete. Your calculated local review is available." : "Local review is active. Online AI is not enabled."
        : "DeepSeek selected suggestions from the calculated review." });
    } catch (error) {
      sendNutritionError(error, response, "Nutrition review could not be created.");
    }
  });

  router.get("/feedback", authMiddleware, (request, response) => {
    try {
      const limit = numberQueryValue(request, "limit", 1, 100) ?? 100;
      const records = listNutritionFeedback(authUserId(request), limit);
      response.json({ records, summary: summariseNutritionFeedback(records) });
    } catch (error) {
      sendNutritionError(error, response, "Nutrition feedback could not be read.");
    }
  });

  router.post("/feedback", authMiddleware, (request, response) => {
    try {
      const body = objectBody(request);
      const record = saveNutritionFeedback(authUserId(request), {
        subjectType: body.subjectType as FeedbackSubject,
        subjectId: body.subjectId as string,
        rating: body.rating as FeedbackRating,
        decision: body.decision as FeedbackDecision,
        comment: body.comment as string | undefined,
        stars: body.stars as number | undefined,
      });
      response.status(201).json({ feedback: record });
    } catch (error) {
      sendNutritionError(error, response, "Nutrition feedback could not be saved.");
    }
  });

  router.get("/catalog/stats", (_request, response) => {
    response.json(getCatalogStats());
  });

  router.get("/ingredients", (request, response) => {
    try {
      const query = oneQueryValue(request, "query") ?? "";
      const limit = numberQueryValue(request, "limit", 1, 100) ?? 20;
      response.json({ ingredients: searchIngredients(query, limit) });
    } catch (error) {
      sendNutritionError(error, response, "Ingredients could not be searched.");
    }
  });

  router.get("/recipes", (request, response) => {
    try {
      const filters = searchFilters(request);
      response.json(searchRecipePageWithCommunity(filters));
    } catch (error) {
      sendNutritionError(error, response, "Recipes could not be searched.");
    }
  });

  router.post("/recipes/custom", authMiddleware, async (request, response) => {
    try {
      const userId = authUserId(request);
      const body = objectBody(request);
      const result = await generateCustomRecipe({
        query: body.query as string,
        baseRecipeId: body.baseRecipeId as string | undefined,
        servings: body.servings as number | undefined,
        substitutions: body.substitutions as CustomRecipeSubstitutionInput[] | undefined,
      }, {
        userId,
        preferences: savedPreferences(userId),
        provider: requestProvider(request, userId),
      });
      accountAccess(userId, request.headers.authorization).check();
      response.status(201).json(result);
    } catch (error) {
      sendNutritionError(error, response, "The custom recipe could not be created.");
    }
  });

  router.post("/recipes/custom/scale", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      const body = objectBody(request);
      const result = scaleCustomRecipe({
        baseRecipeId: body.baseRecipeId as string,
        substitutions: body.substitutions as CustomRecipeSubstitutionInput[],
        servings: body.servings as number,
      }, { userId, preferences: savedPreferences(userId) });
      response.json(result);
    } catch (error) {
      sendNutritionError(error, response, "The custom recipe amount could not be changed.");
    }
  });

  router.get("/recipe-groups", (request, response) => {
    try { response.json(searchRecipeGroups(searchFilters(request))); }
    catch (error) { sendNutritionError(error, response, "Recipe groups could not be loaded."); }
  });

  router.post("/recipes/:id/substitutions", authMiddleware, async (request, response) => {
    try {
      const userId = authUserId(request);
      const body = objectBody(request);
      if (typeof body.ingredientId !== "string") throw new CustomRecipeError("Choose one recipe ingredient.");
      const result = await getIngredientSubstitutions(paramValue(request, "id"), body.ingredientId, {
        userId,
        preferences: savedPreferences(userId),
        provider: requestProvider(request, userId),
      });
      accountAccess(userId, request.headers.authorization).check();
      response.json(result);
    } catch (error) {
      sendNutritionError(error, response, "Ingredient substitutions could not be found.");
    }
  });

  router.get("/recipes/:id", (request, response) => {
    try {
      const recipe = getRecipe(request.params.id);
      if (!recipe) {
        response.status(404).json({ error: "Recipe not found." });
        return;
      }
      const servings = numberQueryValue(request, "servings", 0.25, 100) ?? 1;
      const scaled = executeNutritionFunction({
        name: "scale_recipe",
        arguments: { recipeId: recipe.id, servings },
      }).value;
      const scaledRecipe = scaled.recipe as typeof recipe;
      const scaledNutrition = scaled.nutrition as NutritionValues;
      response.json({
        ...scaled,
        enhancedNutrition: getRecipeEnhancedNutrition(scaledRecipe, scaledNutrition),
      });
    } catch (error) {
      sendNutritionError(error, response, "Recipe details could not be read.");
    }
  });

  router.get("/community/overview", (_request, response) => {
    response.json(communityRecipeOverview());
  });

  router.get("/rag/context", (request, response) => {
    try {
      const query = oneQueryValue(request, "query") ?? "";
      response.json(buildRecipeRetrievalContext(query, searchFilters(request)));
    } catch (error) {
      sendNutritionError(error, response, "Recipe context could not be built.");
    }
  });

  router.get("/plans", authMiddleware, (request, response) => {
    try {
      const limit = numberQueryValue(request, "limit", 1, 50) ?? 20;
      response.json({ plans: listMealPlans(authUserId(request), limit) });
    } catch (error) {
      sendNutritionError(error, response, "Meal plans could not be read.");
    }
  });

  router.post("/plans/generate", authMiddleware, async (request, response) => {
    try {
      const userId = authUserId(request);
      const body = objectBody(request);
      const preferences = savedPreferences(userId);
      const plan = await generateMealPlan({
        duration: planDuration(body.duration),
        startDate: startDateValue(body.startDate),
        health: healthForPlan(userId),
        preferences,
      }, {
        provider: requestProvider(request, userId),
        cache: mealGenerationCache,
        userId,
      });
      accountAccess(userId, request.headers.authorization).check();
      response.status(201).json({ plan: saveMealPlan(userId, plan, "Generated plan") });
    } catch (error) {
      sendNutritionError(error, response, "Meal plan could not be generated.");
    }
  });

  router.get("/plans/:planId", authMiddleware, (request, response) => {
    try {
      const planId = paramValue(request, "planId");
      const plan = getMealPlan(authUserId(request), planId);
      if (!plan) {
        response.status(404).json({ error: "Meal plan not found." });
        return;
      }
      response.json({ plan });
    } catch (error) {
      sendNutritionError(error, response, "Meal plan could not be read.");
    }
  });

  router.get("/plans/:planId/meals/:mealId/alternatives", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      const planId = paramValue(request, "planId");
      const mealId = paramValue(request, "mealId");
      const plan = getMealPlan(userId, planId);
      if (!plan) {
        response.status(404).json({ error: "Meal plan not found." });
        return;
      }
      const meal = mealFromPlan(plan, mealId);
      response.json({ alternatives: findMealAlternatives(meal, savedPreferences(userId)) });
    } catch (error) {
      sendNutritionError(error, response, "Meal alternatives could not be read.");
    }
  });

  router.post("/plans/:planId/meals/:mealId/swap", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      const body = objectBody(request);
      const planId = paramValue(request, "planId");
      const mealId = paramValue(request, "mealId");
      const plan = getMealPlan(userId, planId);
      if (!plan) {
        response.status(404).json({ error: "Meal plan not found." });
        return;
      }
      if (typeof body.recipeId !== "string") throw new PlanValidationError("A recipe id is required.");
      const recipe = getRecipe(body.recipeId);
      const preferences = savedPreferences(userId);
      if (!recipe || !recipeMeetsFoodRestrictions(recipe, {
        dietaryTags: restrictiveDietaryTags(preferences.dietaryPreferences),
        allergies: preferences.allergies,
        excludedIngredients: preferences.dislikedIngredients,
      })) {
        throw new PlanValidationError("The selected recipe does not meet your saved food restrictions.");
      }
      const meal = mealFromPlan(plan, mealId);
      const servings = body.servings === undefined ? meal.servings : body.servings;
      if (typeof servings !== "number") throw new PlanValidationError("Servings must be a number.");
      response.json({ plan: saveMealPlan(userId, replaceMealWithRecipe(plan, meal.id, body.recipeId, servings), "Changed meal") });
    } catch (error) {
      sendNutritionError(error, response, "The meal could not be changed.");
    }
  });

  router.post("/plans/:planId/meals/:mealId/move", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      const body = objectBody(request);
      const planId = paramValue(request, "planId");
      const mealId = paramValue(request, "mealId");
      const plan = getMealPlan(userId, planId);
      if (!plan) {
        response.status(404).json({ error: "Meal plan not found." });
        return;
      }
      if (typeof body.date !== "string") throw new PlanValidationError("A target date is required.");
      const mealType = body.mealType === undefined ? undefined : String(body.mealType);
      const time = body.time === undefined ? undefined : String(body.time);
      response.json({ plan: saveMealPlan(userId, moveMeal(plan, mealId, body.date, mealType, time), "Moved meal") });
    } catch (error) {
      sendNutritionError(error, response, "The meal could not be moved.");
    }
  });

  router.post("/plans/:planId/meals/manual", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      const body = objectBody(request);
      const planId = paramValue(request, "planId");
      const plan = getMealPlan(userId, planId);
      if (!plan) {
        response.status(404).json({ error: "Meal plan not found." });
        return;
      }
      if (typeof body.date !== "string" || typeof body.mealType !== "string" || typeof body.time !== "string" || typeof body.title !== "string") {
        throw new PlanValidationError("Manual meals need a date, type, time, and title.");
      }
      response.json({ plan: saveMealPlan(userId, addManualMeal(plan, {
        date: body.date,
        mealType: body.mealType,
        time: body.time,
        title: body.title,
        nutrition: manualNutrition(body.nutrition),
        notes: typeof body.notes === "string" ? body.notes : undefined,
      }), "Added manual meal") });
    } catch (error) {
      sendNutritionError(error, response, "The manual meal could not be added.");
    }
  });

  router.post("/plans/:planId/meals/:mealId/regenerate", authMiddleware, async (request, response) => {
    try {
      const userId = authUserId(request);
      const planId = paramValue(request, "planId");
      const mealId = paramValue(request, "mealId");
      const plan = getMealPlan(userId, planId);
      if (!plan) {
        response.status(404).json({ error: "Meal plan not found." });
        return;
      }
      const meal = mealFromPlan(plan, mealId);
      const alternatives = findMealAlternatives(meal, savedPreferences(userId), 20);
      const alternative = alternatives[0];
      if (!alternative) throw new PlanValidationError("No replacement recipe is available.");
      response.json({ plan: saveMealPlan(userId, replaceMealWithRecipe(plan, meal.id, alternative.recipe.id, meal.servings), "Regenerated meal") });
    } catch (error) {
      sendNutritionError(error, response, "The meal could not be regenerated.");
    }
  });

  router.post("/plans/:planId/regenerate", authMiddleware, async (request, response) => {
    try {
      const userId = authUserId(request);
      const planId = paramValue(request, "planId");
      const current = getMealPlan(userId, planId);
      if (!current) {
        response.status(404).json({ error: "Meal plan not found." });
        return;
      }
      const generated = await generateMealPlan({
        duration: current.duration,
        startDate: current.startDate,
        health: healthForPlan(userId),
        preferences: savedPreferences(userId),
      }, {
        provider: requestProvider(request, userId),
        cache: mealGenerationCache,
        userId,
      });
      accountAccess(userId, request.headers.authorization).check();
      response.json({ plan: saveMealPlan(userId, { ...generated, id: current.id, createdAt: current.createdAt }, "Regenerated plan") });
    } catch (error) {
      sendNutritionError(error, response, "The meal plan could not be regenerated.");
    }
  });

  router.get("/plans/:planId/versions", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      const planId = paramValue(request, "planId");
      if (!getMealPlan(userId, planId)) {
        response.status(404).json({ error: "Meal plan not found." });
        return;
      }
      response.json({ versions: getMealPlanVersions(userId, planId) });
    } catch (error) {
      sendNutritionError(error, response, "Plan versions could not be read.");
    }
  });

  router.post("/plans/:planId/versions/:versionId/restore", authMiddleware, (request, response) => {
    try {
      const planId = paramValue(request, "planId");
      const versionId = Number(paramValue(request, "versionId"));
      response.json({ plan: restoreMealPlanVersion(authUserId(request), planId, versionId) });
    } catch (error) {
      sendNutritionError(error, response, "The plan version could not be restored.");
    }
  });

  router.get("/shopping-lists", authMiddleware, (request, response) => {
    try {
      const planId = oneQueryValue(request, "planId");
      response.json({ lists: listShoppingLists(authUserId(request), planId) });
    } catch (error) {
      sendNutritionError(error, response, "Shopping lists could not be read.");
    }
  });

  router.post("/shopping-lists", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      const body = objectBody(request);
      if (typeof body.planId !== "string") throw new ShoppingListValidationError("A plan id is required.");
      const plan = getMealPlan(userId, body.planId);
      if (!plan) {
        response.status(404).json({ error: "Meal plan not found." });
        return;
      }
      const mealId = body.mealId === undefined ? undefined : String(body.mealId);
      response.status(201).json({ list: saveShoppingList(userId, createShoppingList(plan, { mealId })) });
    } catch (error) {
      sendNutritionError(error, response, "The shopping list could not be created.");
    }
  });

  router.get("/shopping-lists/:listId", authMiddleware, (request, response) => {
    try {
      const list = getShoppingList(authUserId(request), paramValue(request, "listId"));
      if (!list) {
        response.status(404).json({ error: "Shopping list not found." });
        return;
      }
      response.json({ list });
    } catch (error) {
      sendNutritionError(error, response, "The shopping list could not be read.");
    }
  });

  router.put("/shopping-lists/:listId/items/:itemId", authMiddleware, (request, response) => {
    try {
      const userId = authUserId(request);
      const listId = paramValue(request, "listId");
      const itemId = paramValue(request, "itemId");
      const list = getShoppingList(userId, listId);
      if (!list) {
        response.status(404).json({ error: "Shopping list not found." });
        return;
      }
      const body = objectBody(request);
      const quantity = body.quantity === undefined ? undefined : Number(body.quantity);
      if (body.checked !== undefined && typeof body.checked !== "boolean") throw new ShoppingListValidationError("Checked must be true or false.");
      const updated = updateShoppingListItem(list, itemId, {
        ...(body.checked === undefined ? {} : { checked: body.checked as boolean }),
        ...(quantity === undefined ? {} : { quantity }),
        removed: body.removed === true,
      });
      response.json({ list: saveShoppingList(userId, updated) });
    } catch (error) {
      sendNutritionError(error, response, "The shopping item could not be changed.");
    }
  });

  return router;
}
