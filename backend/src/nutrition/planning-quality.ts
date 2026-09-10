import type { RecipeRecord } from "./types.js";
import { recipeCookingWarning } from "./cooking-validation.js";

export function recipePlanningWarning(recipe: RecipeRecord): string | undefined {
  const cookingWarning = recipeCookingWarning(recipe);
  if (cookingWarning) return cookingWarning;
  const preparation = recipe.preparation.map(step => step.description).join(" ");
  if (/\b(brine|curing|pickling)\b|cooled salt water|keep.*salt water/iu.test(preparation)) {
    return "The consumed amount of preserving liquid is unknown. Ingredient totals include the full liquid, so this recipe is excluded from meal planning.";
  }
  return undefined;
}

export function planningFamily(recipe: RecipeRecord): "component" | "bread" | "sweet" | "meal" {
  if (recipe.meal === "drink" || /\b(sauce|syrup|filling|frosting|icing|dough|crust|batter|stock|broth)\b/iu.test(recipe.title)) return "component";
  if (/\b(bread|rolls?|puffs?|biscuits?)\b|brod|bröd/iu.test(recipe.title)) return "bread";
  if (recipe.meal === "dessert" || /\b(cake|cookies?|pudding|custard|tarts?)\b/iu.test(recipe.title)) return "sweet";
  return "meal";
}

export function eligibleForPlanning(recipe: RecipeRecord): boolean {
  return !recipePlanningWarning(recipe) && planningFamily(recipe) !== "component"
    && recipe.source.startsWith("haleview-template:");
}
