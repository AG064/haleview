import { randomUUID } from "node:crypto";
import { database } from "../storage.js";
import { protectStoredText, unprotectStoredText } from "../protected-data.js";
import type { MealPlan } from "./meal-plans.js";
import type { NutritionValues } from "./types.js";

export type NutritionIntakeSource = "manual" | "plan" | "recipe";

export interface NutritionIntakeEntry {
  id: string;
  title: string;
  source: NutritionIntakeSource;
  sourceId: string | null;
  nutrition: NutritionValues;
}

export interface NutritionIntakeRecord {
  id: string;
  date: string;
  recordedAt: string;
  entries: NutritionIntakeEntry[];
  nutrition: NutritionValues;
}

export interface ManualIntakeInput {
  id?: string;
  date: string;
  title: string;
  source?: "manual" | "recipe";
  sourceId?: string | null;
  nutrition: NutritionValues;
}

export interface IntakeListOptions {
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export class IntakeValidationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "IntakeValidationError";
    this.status = status;
  }
}

const nutritionKeys: Array<keyof NutritionValues> = [
  "caloriesKcal",
  "proteinG",
  "carbsG",
  "fatsG",
  "fiberG",
  "sugarG",
  "sodiumMg",
  "vitaminDMcg",
  "vitaminB12Mcg",
  "ironMg",
  "calciumMg",
  "magnesiumMg",
];

database.exec(`
  CREATE TABLE IF NOT EXISTS nutrition_intake_records (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS nutrition_intake_user ON nutrition_intake_records(user_id);
`);

function userIdValue(userId: number): number {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new IntakeValidationError("A signed-in account is required.", 401);
  }
  return userId;
}

function validText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") throw new IntakeValidationError(`${field} must be text.`);
  const clean = value.trim();
  if (!clean || clean.length > maximum) throw new IntakeValidationError(`${field} has an invalid length.`);
  return clean;
}

function validDate(value: unknown, field = "Intake date"): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new IntakeValidationError(`${field} must use YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new IntakeValidationError(`${field} is not valid.`);
  }
  return value;
}

function validIso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new IntakeValidationError("Recorded time must be a valid ISO timestamp.");
  }
  return new Date(value).toISOString();
}

function emptyNutrition(): NutritionValues {
  return {
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
}

function round(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function validNutrition(value: unknown): NutritionValues {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new IntakeValidationError("Nutrition values are required.");
  }
  const input = value as Record<string, unknown>;
  const result = emptyNutrition();
  for (const key of nutritionKeys) {
    const current = input[key];
    if (typeof current !== "number" || !Number.isFinite(current) || current < 0 || current > 1000000) {
      throw new IntakeValidationError(`${key} must be a non-negative number.`);
    }
    result[key] = round(current);
  }
  if (result.caloriesKcal <= 0) {
    throw new IntakeValidationError("Intake calories must be greater than zero.");
  }
  return result;
}

function addNutrition(total: NutritionValues, nutrition: NutritionValues): void {
  for (const key of nutritionKeys) total[key] = round(total[key] + nutrition[key]);
}

function validSource(value: unknown): NutritionIntakeSource {
  if (value !== "manual" && value !== "plan" && value !== "recipe") {
    throw new IntakeValidationError("Intake source is not supported.");
  }
  return value;
}

function normaliseEntry(value: unknown): NutritionIntakeEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new IntakeValidationError("Each intake entry must be an object.");
  }
  const input = value as Record<string, unknown>;
  const sourceId = input.sourceId;
  if (sourceId !== null && sourceId !== undefined && (typeof sourceId !== "string" || sourceId.length > 160)) {
    throw new IntakeValidationError("Intake source id is not valid.");
  }
  return {
    id: validText(input.id, "Intake entry id", 160),
    title: validText(input.title, "Intake title", 160),
    source: validSource(input.source),
    sourceId: typeof sourceId === "string" && sourceId ? sourceId : null,
    nutrition: validNutrition(input.nutrition),
  };
}

function normaliseRecord(value: unknown): NutritionIntakeRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new IntakeValidationError("Intake record must be an object.");
  }
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.entries) || input.entries.length < 1 || input.entries.length > 20) {
    throw new IntakeValidationError("Intake must contain from 1 to 20 entries.");
  }
  const entries = input.entries.map(normaliseEntry);
  const nutrition = emptyNutrition();
  entries.forEach((entry) => addNutrition(nutrition, entry.nutrition));
  return {
    id: validText(input.id, "Intake id", 160),
    date: validDate(input.date),
    recordedAt: validIso(input.recordedAt),
    entries,
    nutrition,
  };
}

function readRecord(value: string): NutritionIntakeRecord {
  return normaliseRecord(JSON.parse(unprotectStoredText(value)) as unknown);
}

export function createManualIntake(input: ManualIntakeInput, now: () => Date = () => new Date()): NutritionIntakeRecord {
  const recordedAt = now().toISOString();
  const entry: NutritionIntakeEntry = {
    id: `intake-entry-${randomUUID()}`,
    title: validText(input.title, "Intake title", 160),
    source: input.source ?? "manual",
    sourceId: input.sourceId ?? null,
    nutrition: validNutrition(input.nutrition),
  };
  return normaliseRecord({
    id: input.id ?? `intake-${randomUUID()}`,
    date: input.date,
    recordedAt,
    entries: [entry],
  });
}

export function createPlanMealIntake(
  plan: MealPlan,
  mealId: string,
  now: () => Date = () => new Date(),
): NutritionIntakeRecord {
  const meal = plan.days.flatMap((day) => day.meals).find((item) => item.id === mealId);
  if (!meal) throw new IntakeValidationError("The planned meal was not found.", 404);
  return normaliseRecord({
    id: `intake-${randomUUID()}`,
    date: meal.date,
    recordedAt: now().toISOString(),
    entries: [{
      id: `intake-entry-${randomUUID()}`,
      title: meal.title,
      source: "plan",
      sourceId: meal.id,
      nutrition: meal.nutrition,
    }],
  });
}

export function saveIntakeRecord(userId: number, value: NutritionIntakeRecord): NutritionIntakeRecord {
  const safeUserId = userIdValue(userId);
  const record = normaliseRecord(value);
  const owner = database.prepare("SELECT user_id FROM nutrition_intake_records WHERE id = ?").get(record.id) as { user_id: number } | undefined;
  if (owner && owner.user_id !== safeUserId) {
    throw new IntakeValidationError("The intake record could not be saved.", 409);
  }
  database
    .prepare("INSERT INTO nutrition_intake_records (id, user_id, record_json, recorded_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET record_json = excluded.record_json, recorded_at = excluded.recorded_at WHERE nutrition_intake_records.user_id = excluded.user_id")
    .run(record.id, safeUserId, protectStoredText(JSON.stringify(record)), protectStoredText(record.recordedAt));
  database
    .prepare("DELETE FROM nutrition_intake_records WHERE user_id = ? AND id NOT IN (SELECT id FROM nutrition_intake_records WHERE user_id = ? ORDER BY rowid DESC LIMIT 1000)")
    .run(safeUserId, safeUserId);
  return record;
}

export function listIntakeRecords(userId: number, options: IntakeListOptions = {}): NutritionIntakeRecord[] {
  const safeUserId = userIdValue(userId);
  const fromDate = options.fromDate === undefined ? undefined : validDate(options.fromDate, "Start date");
  const toDate = options.toDate === undefined ? undefined : validDate(options.toDate, "End date");
  if (fromDate && toDate && fromDate > toDate) throw new IntakeValidationError("Start date must not be after end date.");
  const limit = options.limit === undefined ? 500 : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new IntakeValidationError("Intake limit must be from 1 to 1000.");
  const rows = database
    .prepare("SELECT record_json FROM nutrition_intake_records WHERE user_id = ? ORDER BY rowid DESC LIMIT ?")
    .all(safeUserId, limit) as Array<{ record_json: string }>;
  return rows
    .map((row) => readRecord(row.record_json))
    .filter((record) => (!fromDate || record.date >= fromDate) && (!toDate || record.date <= toDate));
}

export function deleteIntakeRecord(userId: number, recordId: string): boolean {
  const result = database
    .prepare("DELETE FROM nutrition_intake_records WHERE user_id = ? AND id = ?")
    .run(userIdValue(userId), validText(recordId, "Intake id", 160));
  return result.changes > 0;
}
