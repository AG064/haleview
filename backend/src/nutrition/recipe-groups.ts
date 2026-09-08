import { createHash } from "node:crypto";
import { rankRecipeCandidates } from "./community-rag.js";
import type { RecipeSearchResult, SearchFilters } from "./types.js";

export interface RecipeGroup {
  id: string;
  title: string;
  recipes: RecipeSearchResult[];
}

function groupTitle(title: string): string {
  const base = title.split("(")[0].trim() || title;
  return base.replace(/\s+(?:I|II|III|IV|V|VI|VII|VIII|IX|X|\d+)\.?$/u, "").trim();
}

export function searchRecipeGroups(filters: SearchFilters = {}): { groups: RecipeGroup[]; totalGroups: number; totalRecipes: number } {
  const ranked = rankRecipeCandidates(filters);
  const groups = new Map<string, RecipeGroup>();
  for (const result of ranked) {
    const title = groupTitle(result.recipe.title);
    const key = title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const group = groups.get(key);
    if (group) group.recipes.push(result);
    else groups.set(key, { id: `group-${createHash("sha256").update(key).digest("hex").slice(0, 20)}`, title, recipes: [result] });
  }
  const limit = Number.isInteger(filters.limit) && filters.limit! > 0 ? Math.min(filters.limit!, 50) : 24;
  const offset = Number.isInteger(filters.offset) && filters.offset! >= 0 ? Math.min(filters.offset!, 10000) : 0;
  return { groups: [...groups.values()].slice(offset, offset + limit), totalGroups: groups.size, totalRecipes: ranked.length };
}
