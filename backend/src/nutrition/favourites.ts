import { database } from "../storage.js";
import { protectStoredText } from "../protected-data.js";
import { getRecipe, getRecipeEnhancedNutrition, getRecipeNutrition } from "./catalog.js";
import { CustomRecipeError } from "./custom-recipes.js";
import { getRecipeCreation, type RecipeCreation } from "./recipe-creations.js";
import type { EnhancedNutritionProfile, NutritionValues, RecipeRecord } from "./types.js";

database.exec(`CREATE TABLE IF NOT EXISTS recipe_favourites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id TEXT NOT NULL,
  favourite_json TEXT NOT NULL,
  PRIMARY KEY (user_id, recipe_id)
);`);

export interface RecipeFavourite {
  recipe: RecipeRecord;
  nutrition: NutritionValues;
  enhancedNutrition: EnhancedNutritionProfile;
  creation?: RecipeCreation;
}

function validate(userId: number, recipeId?: string): void {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new CustomRecipeError("Sign in is required.", 401);
  if (recipeId !== undefined && (typeof recipeId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(recipeId))) {
    throw new CustomRecipeError("Choose a valid recipe.");
  }
}

function resolveFavourite(userId: number, recipeId: string): RecipeFavourite | null {
  const recipe = getRecipe(recipeId);
  if (recipe) {
    const nutrition = getRecipeNutrition(recipe);
    return { recipe, nutrition, enhancedNutrition: getRecipeEnhancedNutrition(recipe, nutrition) };
  }
  const creation = getRecipeCreation(userId, recipeId);
  return creation?.saved ? { recipe: creation.recipe, nutrition: creation.nutrition, enhancedNutrition: creation.enhancedNutrition, creation } : null;
}

export function listRecipeFavourites(userId: number): RecipeFavourite[] {
  validate(userId);
  const rows = database.prepare("SELECT recipe_id FROM recipe_favourites WHERE user_id = ? ORDER BY rowid DESC LIMIT 200")
    .all(userId) as Array<{ recipe_id: string }>;
  return rows.flatMap(row => {
    const favourite = resolveFavourite(userId, row.recipe_id);
    return favourite ? [favourite] : [];
  });
}

export function addRecipeFavourite(userId: number, recipeId: string): RecipeFavourite {
  validate(userId, recipeId);
  const favourite = resolveFavourite(userId, recipeId);
  if (!favourite) throw new CustomRecipeError("Recipe not found. Save a created recipe before adding it to Favourites.", 404);
  const existing = database.prepare("SELECT 1 FROM recipe_favourites WHERE user_id = ? AND recipe_id = ?").get(userId, recipeId);
  if (!existing) {
    const count = database.prepare("SELECT COUNT(*) AS count FROM recipe_favourites WHERE user_id = ?").get(userId) as {count: number};
    if (count.count >= 200) throw new CustomRecipeError("Your favourites are full. Remove one before adding another.", 409);
    const value = protectStoredText(JSON.stringify({recipeId, savedAt: new Date().toISOString()}));
    database.prepare("INSERT INTO recipe_favourites (user_id, recipe_id, favourite_json) VALUES (?, ?, ?)").run(userId, recipeId, value);
  }
  return favourite;
}

export function removeRecipeFavourite(userId: number, recipeId: string): void {
  validate(userId, recipeId);
  database.prepare("DELETE FROM recipe_favourites WHERE user_id = ? AND recipe_id = ?").run(userId, recipeId);
}
