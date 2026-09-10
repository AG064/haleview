import { database } from "../storage.js";
import { protectStoredText, unprotectStoredText } from "../protected-data.js";
import { parseNutritionPreferences } from "./preferences.js";
import type { NutritionPreferences } from "./types.js";

export interface NutritionPreferenceHistoryRecord {
  id: number;
  version: number;
  updatedAt: string;
  preferences: NutritionPreferences;
}

database.exec(`
  CREATE TABLE IF NOT EXISTS nutrition_preferences (
    user_id INTEGER PRIMARY KEY,
    preferences_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS nutrition_preference_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    preferences_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

export function getNutritionPreferences(userId: number): NutritionPreferences | null {
  const row = database
    .prepare("SELECT preferences_json FROM nutrition_preferences WHERE user_id = ?")
    .get(userId) as { preferences_json?: string } | undefined;
  if (!row?.preferences_json) {
    return null;
  }
  return JSON.parse(unprotectStoredText(row.preferences_json)) as NutritionPreferences;
}

export function saveNutritionPreferences(userId: number, input: unknown): NutritionPreferences {
  const preferences = parseNutritionPreferences(input);
  const stored = protectStoredText(JSON.stringify(preferences));
  const updatedAt = protectStoredText(new Date().toISOString());
  database.exec("BEGIN");
  try {
    database
      .prepare("INSERT INTO nutrition_preferences (user_id, preferences_json, version, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET preferences_json = excluded.preferences_json, version = excluded.version, updated_at = excluded.updated_at")
      .run(userId, stored, preferences.version, updatedAt);
    database
      .prepare("INSERT INTO nutrition_preference_history (user_id, preferences_json, version, updated_at) VALUES (?, ?, ?, ?)")
      .run(userId, stored, preferences.version, updatedAt);
    database
      .prepare("DELETE FROM nutrition_preference_history WHERE user_id = ? AND id NOT IN (SELECT id FROM nutrition_preference_history WHERE user_id = ? ORDER BY id DESC LIMIT 50)")
      .run(userId, userId);
    database.exec("COMMIT");
    return preferences;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function getNutritionPreferenceHistory(userId: number, limit = 50): NutritionPreferenceHistoryRecord[] {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 50;
  const rows = database
    .prepare("SELECT id, preferences_json, version, updated_at FROM nutrition_preference_history WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, safeLimit) as Array<{ id: number; preferences_json: string; version: number; updated_at: string }>;
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    updatedAt: unprotectStoredText(row.updated_at),
    preferences: JSON.parse(unprotectStoredText(row.preferences_json)) as NutritionPreferences,
  }));
}

export function getHistoricalNutritionPreferenceTerms(userId: number): string[] {
  const counts = new Map<string, number>();
  for (const record of getNutritionPreferenceHistory(userId, 20)) {
    for (const value of [...record.preferences.cuisinePreferences, ...record.preferences.dietaryPreferences]) {
      const clean = value.trim().toLowerCase();
      if (clean) counts.set(clean, (counts.get(clean) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en"))
    .slice(0, 8)
    .map(([value]) => value);
}
