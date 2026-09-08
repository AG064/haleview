import type { RecipeImageCredit, RecipeRecord } from "./types";

export type RecipeVisual = {
  kind: "dish";
  src: string;
  label: string;
  alt: string;
  credit: RecipeImageCredit;
} | { kind: "none" };

export function recipeVisual(recipe: RecipeRecord, failedSources: readonly string[] = []): RecipeVisual {
  if (recipe.imageCredit && recipe.img !== "/images/recipes/placeholder.svg" && !failedSources.includes(recipe.img)) {
    return {
      kind: "dish",
      src: recipe.img,
      label: "Serving example",
      alt: `Serving example for ${recipe.title}, not the exact archive recipe`,
      credit: recipe.imageCredit,
    };
  }

  return { kind: "none" };
}
