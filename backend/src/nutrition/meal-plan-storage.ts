import { database } from "../storage.js";
import { protectStoredText, unprotectStoredText } from "../protected-data.js";
import { normalizePlanSchedule, recalculateMealPlan, type MealPlan } from "./meal-plans.js";

database.exec(`
  CREATE TABLE IF NOT EXISTS meal_plans (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    plan_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS meal_plans_user_updated ON meal_plans(user_id, updated_at);

  CREATE TABLE IF NOT EXISTS meal_plan_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    label TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(plan_id, user_id, version)
  );

  CREATE INDEX IF NOT EXISTS meal_plan_versions_user_plan ON meal_plan_versions(user_id, plan_id, id);
`);

export interface MealPlanVersion {
  id: number;
  planId: string;
  version: number;
  label: string;
  createdAt: string;
  plan: MealPlan;
}

export class MealPlanStorageError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "MealPlanStorageError";
    this.status = status;
  }
}

function userIdValue(userId: number): number {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new MealPlanStorageError("A signed-in account is required.", 401);
  }
  return userId;
}

function readPlan(value: string): MealPlan {
  const parsed = JSON.parse(unprotectStoredText(value)) as Partial<MealPlan>;
  if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string" || !Array.isArray(parsed.days)) {
    throw new Error("The saved meal plan is not valid.");
  }
  return recalculateMealPlan(normalizePlanSchedule(parsed as MealPlan));
}

function storedTimestamp(previous?: string): string {
  const current = new Date();
  if (previous) {
    const previousTime = Date.parse(previous);
    if (Number.isFinite(previousTime) && current.getTime() <= previousTime) {
      current.setTime(previousTime + 1);
    }
  }
  return current.toISOString();
}

export function getMealPlan(userId: number, planId: string): MealPlan | null {
  const row = database
    .prepare("SELECT plan_json FROM meal_plans WHERE user_id = ? AND id = ?")
    .get(userIdValue(userId), planId) as { plan_json?: string } | undefined;
  return row?.plan_json ? readPlan(row.plan_json) : null;
}

export function listMealPlans(userId: number, limit = 20): MealPlan[] {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 20;
  const rows = database
    .prepare("SELECT plan_json FROM meal_plans WHERE user_id = ? ORDER BY rowid DESC LIMIT ?")
    .all(userIdValue(userId), safeLimit) as Array<{ plan_json: string }>;
  return rows.map((row) => readPlan(row.plan_json));
}

export function saveMealPlan(userId: number, plan: MealPlan, label = "Saved plan"): MealPlan {
  const safeUserId = userIdValue(userId);
  const existingRow = database
    .prepare("SELECT version, created_at, updated_at FROM meal_plans WHERE user_id = ? AND id = ?")
    .get(safeUserId, plan.id) as { version: number; created_at: string; updated_at: string } | undefined;
  const otherOwner = database
    .prepare("SELECT user_id FROM meal_plans WHERE id = ?")
    .get(plan.id) as { user_id: number } | undefined;
  if (otherOwner && otherOwner.user_id !== safeUserId) {
    throw new MealPlanStorageError("The meal plan could not be saved.", 409);
  }
  const nextVersion = (existingRow?.version ?? 0) + 1;
  const createdAt = existingRow?.created_at ? unprotectStoredText(existingRow.created_at) : plan.createdAt;
  const updatedAt = storedTimestamp(existingRow?.updated_at ? unprotectStoredText(existingRow.updated_at) : plan.updatedAt);
  const saved = { ...normalizePlanSchedule(plan), version: nextVersion, createdAt, updatedAt };
  const storedPlan = protectStoredText(JSON.stringify(saved));
  const storedCreatedAt = protectStoredText(createdAt);
  const storedUpdatedAt = protectStoredText(updatedAt);

  database.exec("BEGIN");
  try {
    database
      .prepare("INSERT INTO meal_plans (id, user_id, plan_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET plan_json = excluded.plan_json, version = excluded.version, created_at = excluded.created_at, updated_at = excluded.updated_at WHERE meal_plans.user_id = excluded.user_id")
      .run(saved.id, safeUserId, storedPlan, nextVersion, storedCreatedAt, storedUpdatedAt);
    database
      .prepare("INSERT INTO meal_plan_versions (plan_id, user_id, version, label, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(saved.id, safeUserId, nextVersion, label.trim() || "Saved plan", storedPlan, storedUpdatedAt);
    database
      .prepare("DELETE FROM meal_plan_versions WHERE user_id = ? AND plan_id = ? AND id NOT IN (SELECT id FROM meal_plan_versions WHERE user_id = ? AND plan_id = ? ORDER BY id DESC LIMIT 50)")
      .run(safeUserId, saved.id, safeUserId, saved.id);
    database.exec("COMMIT");
    return saved;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function getMealPlanVersions(userId: number, planId: string): MealPlanVersion[] {
  const rows = database
    .prepare("SELECT id, plan_id, version, label, snapshot_json, created_at FROM meal_plan_versions WHERE user_id = ? AND plan_id = ? ORDER BY id DESC LIMIT 50")
    .all(userIdValue(userId), planId) as Array<{
      id: number;
      plan_id: string;
      version: number;
      label: string;
      snapshot_json: string;
      created_at: string;
    }>;
  return rows.map((row) => ({
    id: row.id,
    planId: row.plan_id,
    version: row.version,
    label: row.label,
    createdAt: unprotectStoredText(row.created_at),
    plan: readPlan(row.snapshot_json),
  }));
}

export function restoreMealPlanVersion(userId: number, planId: string, versionId: number): MealPlan {
  if (!Number.isInteger(versionId) || versionId <= 0) {
    throw new MealPlanStorageError("A valid plan version is required.");
  }
  const row = database
    .prepare("SELECT snapshot_json FROM meal_plan_versions WHERE id = ? AND user_id = ? AND plan_id = ?")
    .get(versionId, userIdValue(userId), planId) as { snapshot_json?: string } | undefined;
  if (!row?.snapshot_json) {
    throw new MealPlanStorageError("The selected plan version was not found.", 404);
  }
  const current = getMealPlan(userId, planId);
  if (!current) {
    throw new MealPlanStorageError("The meal plan was not found.", 404);
  }
  return saveMealPlan(userId, {
    ...readPlan(row.snapshot_json),
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  }, "Restored plan version");
}
