import { database } from "../storage.js";
import { unprotectStoredText } from "../protected-data.js";

const collections = {
  preferences: "SELECT preferences_json AS value FROM nutrition_preferences WHERE user_id = ? ORDER BY rowid",
  preferenceHistory: "SELECT preferences_json AS value FROM nutrition_preference_history WHERE user_id = ? ORDER BY id",
  plans: "SELECT plan_json AS value FROM meal_plans WHERE user_id = ? ORDER BY rowid",
  planVersions: "SELECT snapshot_json AS value FROM meal_plan_versions WHERE user_id = ? ORDER BY id",
  shoppingLists: "SELECT list_json AS value FROM shopping_lists WHERE user_id = ? ORDER BY rowid",
  intake: "SELECT record_json AS value FROM nutrition_intake_records WHERE user_id = ? ORDER BY rowid",
  feedback: "SELECT feedback_json AS value FROM nutrition_feedback WHERE user_id = ? ORDER BY rowid",
  createdRecipes: "SELECT recipe_json AS value FROM recipe_creations WHERE user_id = ? ORDER BY rowid",
  favourites: "SELECT favourite_json AS value FROM recipe_favourites WHERE user_id = ? ORDER BY rowid",
} as const;

export function exportNutritionData(userId: number): Record<keyof typeof collections, unknown[]> {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("A valid account is required for export.");
  return Object.fromEntries(Object.entries(collections).map(([name, query]) => {
    const rows = database.prepare(query).all(userId) as Array<{ value: string }>;
    return [name, rows.map((row) => JSON.parse(unprotectStoredText(row.value)) as unknown)];
  })) as Record<keyof typeof collections, unknown[]>;
}
