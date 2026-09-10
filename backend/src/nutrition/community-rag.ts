import { getRecipe, searchRecipeCandidates } from "./catalog.js";
import { communityRecipeSignals, userRecipePreferences } from "./feedback.js";
import { getHistoricalNutritionPreferenceTerms } from "./storage.js";
import type { CommunityRecipeSignal, RecipeSearchResult, SearchFilters } from "./types.js";

function preferenceTerms(userId: number | undefined): { terms: string[]; liked: Set<string>; disliked: Set<string> } {
  if (!userId) return { terms: [], liked: new Set(), disliked: new Set() };
  const preferences = userRecipePreferences(userId);
  const liked = new Set(preferences.likedRecipeIds);
  const disliked = new Set(preferences.dislikedRecipeIds);
  const terms = preferences.likedRecipeIds.slice(0, 5).flatMap((recipeId) => {
    const recipe = getRecipe(recipeId);
    return recipe ? [recipe.cuisine, recipe.meal, ...recipe.dietary_tags.slice(0, 3)] : [];
  });
  return { terms: [...new Set([...terms, ...getHistoricalNutritionPreferenceTerms(userId)])].slice(0, 12), liked, disliked };
}

function signalMap(): Map<string, CommunityRecipeSignal> {
  return new Map(communityRecipeSignals().map((signal) => [signal.recipeId, signal]));
}

export function searchRecipesWithCommunity(filters: SearchFilters = {}, userId?: number): RecipeSearchResult[] {
  return searchRecipePageWithCommunity(filters, userId).recipes;
}

export function searchRecipePageWithCommunity(filters: SearchFilters = {}, userId?: number): { recipes: RecipeSearchResult[]; total: number } {
  const requestedLimit = Number.isInteger(filters.limit) && filters.limit! > 0 ? Math.min(filters.limit!, 50) : 20;
  const requestedOffset = Number.isInteger(filters.offset) && filters.offset! >= 0 ? Math.min(filters.offset!, 10000) : 0;
  const ranked = rankRecipeCandidates(filters, userId);
  return { recipes: ranked.slice(requestedOffset, requestedOffset + requestedLimit), total: ranked.length };
}

export function rankRecipeCandidates(filters: SearchFilters = {}, userId?: number): RecipeSearchResult[] {
  const personal = preferenceTerms(userId);
  const expandedQuery = [filters.query?.trim() ?? "", ...personal.terms].filter(Boolean).join(" ").slice(0, 160);
  const candidates = searchRecipeCandidates({
    ...filters,
    query: expandedQuery || undefined,
  });
  const signals = signalMap();
  const ranked = candidates
    .filter((result) => !personal.disliked.has(result.recipe.id))
    .map((result) => {
      const community = signals.get(result.recipe.id);
      const personalBoost = personal.liked.has(result.recipe.id) ? 0.15 : 0;
      const communityBoost = (community?.score ?? 0) * 0.16 + (community?.verified ? 0.04 : 0);
      const rankScore = Math.round((result.relevance * 0.8 + personalBoost + communityBoost) * 1000000) / 1000000;
      return { ...result, ...(community ? { community } : {}), rankScore };
    });
  ranked.sort((left, right) => {
    const scoreDifference = (right.rankScore ?? 0) - (left.rankScore ?? 0);
    if (scoreDifference !== 0) return scoreDifference;
    const relevanceDifference = right.relevance - left.relevance;
    if (relevanceDifference !== 0) return relevanceDifference;
    const photoDifference = Number(Boolean(right.recipe.imageCredit)) - Number(Boolean(left.recipe.imageCredit));
    if (photoDifference !== 0) return photoDifference;
    return left.recipe.title.localeCompare(right.recipe.title, "en");
  });
  return ranked;
}

export function communityRecipeOverview(): { ratedRecipes: number; verifiedRecipes: number; ratings: number } {
  const signals = communityRecipeSignals();
  return {
    ratedRecipes: signals.length,
    verifiedRecipes: signals.filter((signal) => signal.verified).length,
    ratings: signals.reduce((total, signal) => total + signal.ratingCount, 0),
  };
}
