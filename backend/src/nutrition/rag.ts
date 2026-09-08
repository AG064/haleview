import { rankRecipeCandidates, searchRecipesWithCommunity } from "./community-rag.js";
import { eligibleForPlanning, planningFamily } from "./planning-quality.js";
import type { RecipeSearchResult, SearchFilters } from "./types.js";

export interface RecipeRetrievalContext {
  planning?: boolean;
  query: string;
  retrievedRecipes: RecipeSearchResult[];
  augmentedPrompt: string;
  personalisationTerms: string[];
}

function sourceBlock(result: RecipeSearchResult): string {
  const recipe = result.recipe;
  const ingredients = recipe.ingredients.map((item) => `${item.quantity}${item.unit} ${item.name}`).join(", ");
  const nutrition = result.nutrition;
  const archive = recipe.source.startsWith("open-recipe-archive:");
  return [
    `Recipe ID: ${recipe.id}`,
    `Title: ${recipe.title}`,
    `Cuisine: ${recipe.cuisine}`,
    `Meal: ${recipe.meal}`,
    archive ? `Servings: ${recipe.servings} recipe unit(s). The source yield is unknown.` : `Servings: ${recipe.servings} declared serving(s). Ingredient quantities are recipe totals.`,
    `Ingredients: ${ingredients}`,
    `Nutrition per serving${archive ? " (one recipe unit, not a measured dish serving)" : ""}: ${nutrition.caloriesKcal} calories (${nutrition.caloriesKcal} kcal), ${nutrition.proteinG} g protein, ${nutrition.carbsG} g carbohydrates, ${nutrition.fatsG} g fat`,
    `Summary: ${recipe.summary}`,
    result.community ? `Community rating: ${result.community.averageStars} of 5 from ${result.community.ratingCount} rating(s). Verified: ${result.community.verified ? "yes" : "no"}` : "Community rating: not rated yet"
  ].join("\n");
}

export function buildRecipeRetrievalContext(query: string, filters: SearchFilters = {}, options: { userId?: number; planning?: boolean } = {}): RecipeRetrievalContext {
  const cleanQuery = query.trim();
  const retrievedRecipes = options.planning
    ? planningCandidates(rankRecipeCandidates({ ...filters, query: cleanQuery }, options.userId))
    : searchRecipesWithCommunity({ ...filters, query: cleanQuery, limit: Math.min(filters.limit ?? 5, 10) }, options.userId);
  const blocks = retrievedRecipes.map(sourceBlock);
  const personalisationTerms = options.userId
    ? [...new Set(retrievedRecipes.flatMap((result) => [result.recipe.cuisine, result.recipe.meal, ...result.recipe.dietary_tags]))].slice(0, 12)
    : [];
  const augmentedPrompt = [
    "Use only the supplied recipe data. Do not invent ingredients, quantities, nutrition values, or recipe identifiers.",
    `Search request: ${cleanQuery || "all recipes"}`,
    blocks.length > 0 ? blocks.join("\n\n") : "No matching recipes were found."
  ].join("\n\n");
  return { query: cleanQuery, retrievedRecipes, augmentedPrompt, personalisationTerms, ...(options.planning ? { planning: true } : {}) };
}

function planningCandidates(ranked: RecipeSearchResult[]): RecipeSearchResult[] {
  const eligible = ranked.filter(item => eligibleForPlanning(item.recipe) && item.nutrition.caloriesKcal > 0);
  const protein = [...eligible].sort((a, b) => b.nutrition.proteinG / b.nutrition.caloriesKcal - a.nutrition.proteinG / a.nutrition.caloriesKcal);
  const fibre = [...eligible].sort((a, b) => b.nutrition.fiberG / b.nutrition.caloriesKcal - a.nutrition.fiberG / a.nutrition.caloriesKcal);
  const meals = eligible.filter(item => planningFamily(item.recipe) === "meal");
  const pools = [meals, protein, fibre, eligible];
  const result: RecipeSearchResult[] = [];
  const seen = new Set<string>();
  const families = new Map<string, number>();
  for (let index = 0; index < eligible.length && result.length < 32; index += 1) {
    for (const pool of pools) {
      const item = pool[index];
      if (!item || seen.has(item.recipe.id) || result.length === 32) continue;
      const family = planningFamily(item.recipe);
      if (family !== "meal" && (families.get(family) ?? 0) >= 6) continue;
      result.push(item); seen.add(item.recipe.id); families.set(family, (families.get(family) ?? 0) + 1);
    }
  }
  return result;
}
