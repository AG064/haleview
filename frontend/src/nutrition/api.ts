import { ApiError } from "../api";
import type {
  RecipeGroup,
  RecipeCreation,
  RecipeFavourite,
  MealPlan,
  MealPlanVersion,
  NutritionFeedback,
  NutritionFeedbackSummary,
  NutritionIntakeRecord,
  NutritionPreferenceHistory,
  NutritionPreferences,
  NutritionProgressResult,
  RecipeRecord,
  RecipeSearchFilters,
  RecipeSearchResult,
  NutritionValues,
  ShoppingList,
  CustomRecipeResult,
  IngredientSubstitution,
  EnhancedNutritionProfile,
  NutritionAdvice,
} from "./types";

export type SessionRequest = <T>(operation: (token: string) => Promise<T>) => Promise<T>;

export async function listRecipeFavourites(token: string): Promise<RecipeFavourite[]> {
  const result = await authenticatedJson<{recipes: RecipeFavourite[]}>("/api/nutrition/favourites", token);
  return result.recipes;
}
export function addRecipeFavourite(id: string, token: string): Promise<RecipeFavourite> {
  return authenticatedJson(`/api/nutrition/favourites/${encodeURIComponent(id)}`, token, "PUT", {});
}
export function removeRecipeFavourite(id: string, token: string): Promise<{message: string}> {
  return authenticatedJson(`/api/nutrition/favourites/${encodeURIComponent(id)}`, token, "DELETE");
}

export function createRecipe(input: { mode: "describe" | "combine"; query: string; servings: number; maxMinutes: number; sourceRecipeIds: string[] }, token: string): Promise<RecipeCreation> {
  return authenticatedJson("/api/nutrition/creations", token, "POST", input);
}
export function getCreatedRecipe(id: string, token: string): Promise<RecipeCreation> {
  return authenticatedJson(`/api/nutrition/creations/${encodeURIComponent(id)}`, token);
}
export async function listCreatedRecipes(token: string): Promise<RecipeCreation[]> {
  const result = await authenticatedJson<{ recipes: RecipeCreation[] }>("/api/nutrition/creations", token);
  return result.recipes;
}
export async function searchCreationSources(query: string, token: string): Promise<RecipeSearchResult[]> {
  const result = await authenticatedJson<{ recipes: RecipeSearchResult[] }>(`/api/nutrition/creations/sources?query=${encodeURIComponent(query)}`, token);
  return result.recipes;
}
export function saveCreatedRecipe(id: string, servings: number, token: string): Promise<RecipeCreation> {
  return authenticatedJson(`/api/nutrition/creations/${encodeURIComponent(id)}/save`, token, "POST", { servings });
}
export function removeCreatedRecipe(id: string, token: string): Promise<{ message: string }> {
  return authenticatedJson(`/api/nutrition/creations/${encodeURIComponent(id)}`, token, "DELETE");
}
export function scaleCreatedRecipe(id: string, servings: number, token: string): Promise<RecipeCreation> {
  return authenticatedJson(`/api/nutrition/creations/${encodeURIComponent(id)}/scale`, token, "POST", { servings });
}
export async function addCreatedRecipeToPlan(planId: string, input: { recipeId: string; servings: number; date: string; time: string; mealType: string }, token: string): Promise<MealPlan> {
  const result = await authenticatedJson<{ plan: MealPlan }>(`/api/nutrition/plans/${encodeURIComponent(planId)}/creations`, token, "POST", input);
  return result.plan;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}

async function authenticatedJson<T>(path: string, token: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new ApiError(response.status, await readError(response));
  return (await response.json()) as T;
}

function queryString(filters: RecipeSearchFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(","));
    } else {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export async function searchRecipes(filters: RecipeSearchFilters = {}): Promise<RecipeSearchResult[]> {
  return (await searchRecipePage(filters)).recipes;
}

export async function searchRecipePage(filters: RecipeSearchFilters = {}): Promise<{ recipes: RecipeSearchResult[]; total: number }> {
  const query = queryString(filters);
  const response = await fetch(`/api/nutrition/recipes${query ? `?${query}` : ""}`);
  if (!response.ok) throw new ApiError(response.status, await readError(response));
  return (await response.json()) as { recipes: RecipeSearchResult[]; total: number };
}

export async function getRecipe(recipeId: string, servings = 1): Promise<{ recipe: RecipeRecord; nutrition: NutritionValues; enhancedNutrition: EnhancedNutritionProfile }> {
  const response = await fetch(`/api/nutrition/recipes/${encodeURIComponent(recipeId)}?servings=${encodeURIComponent(servings)}`);
  if (!response.ok) throw new ApiError(response.status, await readError(response));
  return (await response.json()) as { recipe: RecipeRecord; nutrition: NutritionValues; enhancedNutrition: EnhancedNutritionProfile };
}

export async function generateCustomRecipe(
  input: { query: string; baseRecipeId?: string; servings?: number; substitutions?: Array<{ fromIngredientId: string; toIngredientId: string }> },
  token: string,
): Promise<CustomRecipeResult> {
  return authenticatedJson<CustomRecipeResult>("/api/nutrition/recipes/custom", token, "POST", input);
}

export async function getIngredientSubstitutions(
  recipeId: string,
  ingredientId: string,
  token: string,
): Promise<{ recipeId: string; ingredientId: string; source: "local" | "deepseek"; model: string | null; alternatives: IngredientSubstitution[] }> {
  return authenticatedJson(`/api/nutrition/recipes/${encodeURIComponent(recipeId)}/substitutions`, token, "POST", { ingredientId });
}

export async function searchRecipeGroups(filters: RecipeSearchFilters = {}): Promise<{ groups: RecipeGroup[]; totalGroups: number; totalRecipes: number }> {
  const response = await fetch(`/api/nutrition/recipe-groups?${queryString(filters)}`);
  if (!response.ok) throw new ApiError(response.status, await readError(response));
  return await response.json() as { groups: RecipeGroup[]; totalGroups: number; totalRecipes: number };
}

export async function scaleCustomRecipe(
  input: { baseRecipeId: string; substitutions: Array<{ fromIngredientId: string; toIngredientId: string }>; servings: number },
  token: string,
): Promise<CustomRecipeResult> {
  return authenticatedJson<CustomRecipeResult>("/api/nutrition/recipes/custom/scale", token, "POST", input);
}

export async function getNutritionPreferences(token: string): Promise<NutritionPreferences | null> {
  const response = await fetch("/api/nutrition/preferences", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new ApiError(response.status, await readError(response));
  const body = (await response.json()) as { preferences: NutritionPreferences | null };
  return body.preferences;
}

export async function getNutritionDefaults(token: string): Promise<NutritionPreferences> {
  const response = await fetch("/api/nutrition/defaults", { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new ApiError(response.status, await readError(response));
  const body = (await response.json()) as { preferences: NutritionPreferences };
  return body.preferences;
}

export async function saveNutritionPreferences(preferences: NutritionPreferences, token: string): Promise<NutritionPreferences> {
  const response = await fetch("/api/nutrition/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(preferences)
  });
  if (!response.ok) throw new ApiError(response.status, await readError(response));
  const body = (await response.json()) as { preferences: NutritionPreferences };
  return body.preferences;
}

export async function listMealPlans(token: string): Promise<MealPlan[]> {
  const body = await authenticatedJson<{ plans: MealPlan[] }>("/api/nutrition/plans", token);
  return body.plans;
}

export async function generateMealPlan(duration: "day" | "week", startDate: string, token: string): Promise<MealPlan> {
  const body = await authenticatedJson<{ plan: MealPlan }>("/api/nutrition/plans/generate", token, "POST", { duration, startDate });
  return body.plan;
}

export async function getMealPlan(planId: string, token: string): Promise<MealPlan> {
  const body = await authenticatedJson<{ plan: MealPlan }>(`/api/nutrition/plans/${encodeURIComponent(planId)}`, token);
  return body.plan;
}

export async function getMealAlternatives(planId: string, mealId: string, token: string): Promise<RecipeSearchResult[]> {
  const body = await authenticatedJson<{ alternatives: RecipeSearchResult[] }>(
    `/api/nutrition/plans/${encodeURIComponent(planId)}/meals/${encodeURIComponent(mealId)}/alternatives`,
    token,
  );
  return body.alternatives;
}

export async function swapMeal(planId: string, mealId: string, recipeId: string, servings: number, token: string): Promise<MealPlan> {
  const body = await authenticatedJson<{ plan: MealPlan }>(
    `/api/nutrition/plans/${encodeURIComponent(planId)}/meals/${encodeURIComponent(mealId)}/swap`,
    token,
    "POST",
    { recipeId, servings },
  );
  return body.plan;
}

export async function moveMeal(planId: string, mealId: string, date: string, mealType: string, time: string, token: string): Promise<MealPlan> {
  const body = await authenticatedJson<{ plan: MealPlan }>(
    `/api/nutrition/plans/${encodeURIComponent(planId)}/meals/${encodeURIComponent(mealId)}/move`,
    token,
    "POST",
    { date, mealType, time },
  );
  return body.plan;
}

export async function addManualMeal(
  planId: string,
  input: { date: string; mealType: string; time: string; title: string; nutrition: NutritionValues; notes?: string },
  token: string,
): Promise<MealPlan> {
  const body = await authenticatedJson<{ plan: MealPlan }>(`/api/nutrition/plans/${encodeURIComponent(planId)}/meals/manual`, token, "POST", input);
  return body.plan;
}

export async function regenerateMeal(planId: string, mealId: string, token: string): Promise<MealPlan> {
  const body = await authenticatedJson<{ plan: MealPlan }>(
    `/api/nutrition/plans/${encodeURIComponent(planId)}/meals/${encodeURIComponent(mealId)}/regenerate`,
    token,
    "POST",
  );
  return body.plan;
}

export async function regenerateMealPlan(planId: string, token: string): Promise<MealPlan> {
  const body = await authenticatedJson<{ plan: MealPlan }>(`/api/nutrition/plans/${encodeURIComponent(planId)}/regenerate`, token, "POST");
  return body.plan;
}

export async function getMealPlanVersions(planId: string, token: string): Promise<MealPlanVersion[]> {
  const body = await authenticatedJson<{ versions: MealPlanVersion[] }>(`/api/nutrition/plans/${encodeURIComponent(planId)}/versions`, token);
  return body.versions;
}

export async function restoreMealPlanVersion(planId: string, versionId: number, token: string): Promise<MealPlan> {
  const body = await authenticatedJson<{ plan: MealPlan }>(
    `/api/nutrition/plans/${encodeURIComponent(planId)}/versions/${encodeURIComponent(versionId)}/restore`,
    token,
    "POST",
  );
  return body.plan;
}

export async function listShoppingLists(token: string, planId?: string): Promise<ShoppingList[]> {
  const suffix = planId ? `?planId=${encodeURIComponent(planId)}` : "";
  const body = await authenticatedJson<{ lists: ShoppingList[] }>(`/api/nutrition/shopping-lists${suffix}`, token);
  return body.lists;
}

export async function createShoppingList(planId: string, mealId: string | undefined, token: string): Promise<ShoppingList> {
  const body = await authenticatedJson<{ list: ShoppingList }>("/api/nutrition/shopping-lists", token, "POST", {
    planId,
    ...(mealId ? { mealId } : {}),
  });
  return body.list;
}

export async function updateShoppingItem(
  listId: string,
  itemId: string,
  change: { quantity?: number; removed?: boolean; checked?: boolean },
  token: string,
): Promise<ShoppingList> {
  const body = await authenticatedJson<{ list: ShoppingList }>(
    `/api/nutrition/shopping-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`,
    token,
    "PUT",
    change,
  );
  return body.list;
}

export async function listNutritionIntake(token: string): Promise<NutritionIntakeRecord[]> {
  const body = await authenticatedJson<{ records: NutritionIntakeRecord[] }>("/api/nutrition/intake", token);
  return body.records;
}

export async function recordManualIntake(
  input: { date: string; title: string; nutrition: NutritionValues },
  token: string,
): Promise<NutritionIntakeRecord> {
  const body = await authenticatedJson<{ record: NutritionIntakeRecord }>("/api/nutrition/intake", token, "POST", input);
  return body.record;
}

export async function recordPlanMeal(planId: string, mealId: string, token: string): Promise<NutritionIntakeRecord> {
  const body = await authenticatedJson<{ record: NutritionIntakeRecord }>("/api/nutrition/intake/from-plan", token, "POST", { planId, mealId });
  return body.record;
}

export async function removeNutritionIntake(recordId: string, token: string): Promise<void> {
  await authenticatedJson<{ message: string }>(`/api/nutrition/intake/${encodeURIComponent(recordId)}`, token, "DELETE");
}

export async function getNutritionProgress(token: string): Promise<NutritionProgressResult> {
  const body = await authenticatedJson<{ progress: NutritionProgressResult }>("/api/nutrition/progress", token);
  return body.progress;
}

export async function requestNutritionReview(token: string): Promise<{ summary: NutritionAdvice; progress: NutritionProgressResult; message: string }> {
  return authenticatedJson("/api/nutrition/review", token, "POST", {});
}

export async function getNutritionPreferenceHistory(token: string): Promise<NutritionPreferenceHistory[]> {
  const body = await authenticatedJson<{ history: NutritionPreferenceHistory[] }>("/api/nutrition/preferences/history", token);
  return body.history;
}

export async function listNutritionFeedback(token: string): Promise<{ records: NutritionFeedback[]; summary: NutritionFeedbackSummary }> {
  return authenticatedJson<{ records: NutritionFeedback[]; summary: NutritionFeedbackSummary }>("/api/nutrition/feedback", token);
}

export async function saveNutritionFeedback(
  input: { subjectType: NutritionFeedback["subjectType"]; subjectId: string; rating: NutritionFeedback["rating"]; decision: NutritionFeedback["decision"]; comment?: string; stars?: number },
  token: string,
): Promise<NutritionFeedback> {
  const body = await authenticatedJson<{ feedback: NutritionFeedback }>("/api/nutrition/feedback", token, "POST", input);
  return body.feedback;
}
