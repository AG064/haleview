import { dataFilePath } from "./runtime-path.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildProfile, parsePrivacy, type HealthProfile, type PrivacySettings } from "./profile.js";
import { buildLocalGuidance, type Guidance } from "./recommendations.js";
import { isProtectedStoredText, migrateProtectedText, protectStoredText, protectedLookupHash, unprotectStoredText } from "./protected-data.js";

export interface WeightHistoryRecord {
  id: number;
  weightKg: number;
  recordedAt: string;
}

export interface ActivityHistoryRecord {
  id: number;
  activeDays: number;
  recordedAt: string;
}

export interface AnalyticsHistoryRecord {
  id: number;
  wellnessScore: number;
  bmi: number;
  bmiScore: number;
  activityScore: number;
  goalProgress: number;
  habitsScore: number;
  recordedAt: string;
}

export interface HealthHistory {
  weights: WeightHistoryRecord[];
  activities: ActivityHistoryRecord[];
  analytics: AnalyticsHistoryRecord[];
}

export interface RecommendationHistoryRecord {
  version: number;
  generatedAt: string;
  source: Guidance["source"];
  guidance: Guidance;
}

export class HistoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryValidationError";
  }
}

export class DuplicateActivityError extends Error {
  constructor() {
    super("An activity record already exists for this time.");
    this.name = "DuplicateActivityError";
  }
}

interface ActivityInput {
  activeDays: number;
  recordedAt: string;
}

const databasePath = dataFilePath();
mkdirSync(dirname(databasePath), { recursive: true });

export const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    profile_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id)
  );

  CREATE TABLE IF NOT EXISTS weight_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    weight_kg TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    recorded_at_hash TEXT,
    UNIQUE(user_id, recorded_at_hash)
  );

  CREATE TABLE IF NOT EXISTS activity_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    active_days TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    recorded_at_hash TEXT,
    UNIQUE(user_id, recorded_at_hash)
  );

  CREATE TABLE IF NOT EXISTS privacy_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    settings_json TEXT NOT NULL,
    consented_at TEXT NOT NULL,
    UNIQUE(user_id)
  );

  CREATE TABLE IF NOT EXISTS analytics_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    wellness_score TEXT NOT NULL,
    bmi TEXT NOT NULL,
    bmi_score TEXT,
    activity_score TEXT NOT NULL,
    goal_progress TEXT NOT NULL,
    habits_score TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    recorded_at_hash TEXT,
    UNIQUE(user_id, recorded_at_hash)
  );

  CREATE TABLE IF NOT EXISTS recommendation_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    recommendation_json TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    UNIQUE(user_id)
  );

  CREATE TABLE IF NOT EXISTS recommendation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    recommendation_json TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    generated_at_hash TEXT NOT NULL,
    source TEXT NOT NULL
  );
`);

function tableHasColumn(table: string, column: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === column);
}

function migrateLegacyTable(table: string, createSql: string, copySql: string): void {
  if (tableHasColumn(table, "user_id")) {
    return;
  }
  const legacyTable = `${table}_legacy`;
  database.exec(`ALTER TABLE ${table} RENAME TO ${legacyTable}`);
  database.exec(createSql);
  database.exec(copySql.replaceAll("__LEGACY_TABLE__", legacyTable));
  database.exec(`DROP TABLE ${legacyTable}`);
}

function migrateLegacyStorage(): void {
  const migrations: Array<[string, string, string]> = [
    [
      "profile",
      `CREATE TABLE profile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        profile_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id)
      )`,
      "INSERT INTO profile (id, user_id, profile_json, updated_at) SELECT id, NULL, profile_json, updated_at FROM __LEGACY_TABLE__"
    ],
    [
      "weight_history",
      `CREATE TABLE weight_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        weight_kg TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        recorded_at_hash TEXT,
        UNIQUE(user_id, recorded_at_hash)
      )`,
      "INSERT INTO weight_history (id, user_id, weight_kg, recorded_at) SELECT id, NULL, weight_kg, recorded_at FROM __LEGACY_TABLE__"
    ],
    [
      "activity_history",
      `CREATE TABLE activity_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        active_days TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        recorded_at_hash TEXT,
        UNIQUE(user_id, recorded_at_hash)
      )`,
      "INSERT INTO activity_history (id, user_id, active_days, recorded_at) SELECT id, NULL, active_days, recorded_at FROM __LEGACY_TABLE__"
    ],
    [
      "privacy_settings",
      `CREATE TABLE privacy_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        settings_json TEXT NOT NULL,
        consented_at TEXT NOT NULL,
        UNIQUE(user_id)
      )`,
      "INSERT INTO privacy_settings (id, user_id, settings_json, consented_at) SELECT id, NULL, settings_json, consented_at FROM __LEGACY_TABLE__"
    ],
    [
      "analytics_history",
      `CREATE TABLE analytics_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        wellness_score TEXT NOT NULL,
        bmi TEXT NOT NULL,
        bmi_score TEXT,
        activity_score TEXT NOT NULL,
        goal_progress TEXT NOT NULL,
        habits_score TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        recorded_at_hash TEXT,
        UNIQUE(user_id, recorded_at_hash)
      )`,
      "INSERT INTO analytics_history (id, user_id, wellness_score, bmi, activity_score, goal_progress, habits_score, recorded_at) SELECT id, NULL, wellness_score, bmi, activity_score, goal_progress, habits_score, recorded_at FROM __LEGACY_TABLE__"
    ],
    [
      "recommendation_cache",
      `CREATE TABLE recommendation_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        recommendation_json TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        UNIQUE(user_id)
      )`,
      "INSERT INTO recommendation_cache (id, user_id, recommendation_json, generated_at) SELECT id, NULL, recommendation_json, generated_at FROM __LEGACY_TABLE__"
    ]
  ];
  if (!migrations.some(([table]) => !tableHasColumn(table, "user_id"))) {
    return;
  }
  database.exec("BEGIN");
  try {
    for (const [table, createSql, copySql] of migrations) {
      migrateLegacyTable(table, createSql, copySql);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
function timestampHash(value: string): string {
  return protectedLookupHash(value);
}

function protectedValue(value: unknown): string {
  const text = String(value);
  return isProtectedStoredText(text) ? text : protectStoredText(text);
}

function migrateProtectedStorage(): void {
  if (!tableHasColumn("analytics_history", "bmi_score")) {
    database.exec("ALTER TABLE analytics_history ADD COLUMN bmi_score TEXT");
  }
  const analyticsWithoutBmiScore = database
    .prepare("SELECT id, bmi FROM analytics_history WHERE bmi_score IS NULL")
    .all() as Array<{ id: number; bmi: string }>;
  const setBmiScore = database.prepare("UPDATE analytics_history SET bmi_score = ? WHERE id = ?");
  for (const row of analyticsWithoutBmiScore) {
    const bmi = Number(unprotectStoredText(row.bmi));
    const score = Math.round(Math.max(0, Math.min(100, 100 - Math.abs(bmi - 22) * 5)));
    setBmiScore.run(protectStoredText(String(score)), row.id);
  }
  const historyFields: Array<["weight_history" | "activity_history" | "analytics_history", string[]]> = [
    ["weight_history", ["weight_kg"]],
    ["activity_history", ["active_days"]],
    ["analytics_history", ["wellness_score", "bmi", "bmi_score", "activity_score", "goal_progress", "habits_score"]]
  ];
  for (const [table] of historyFields) {
    if (!tableHasColumn(table, "recorded_at_hash")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN recorded_at_hash TEXT`);
    }
  }
  const fields: Array<[string, string]> = [
    ["profile", "profile_json"],
    ["profile", "updated_at"],
    ["privacy_settings", "settings_json"],
    ["privacy_settings", "consented_at"],
    ["recommendation_cache", "recommendation_json"],
    ["recommendation_cache", "generated_at"],
    ["recommendation_history", "recommendation_json"],
    ["recommendation_history", "generated_at"]
  ];
  database.exec("BEGIN");
  try {
    for (const [table, field] of fields) {
      const rows = database.prepare(`SELECT id, ${field} FROM ${table}`).all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        const value = row[field];
        if (typeof value === "string" && !isProtectedStoredText(value)) {
          database.prepare(`UPDATE ${table} SET ${field} = ? WHERE id = ?`).run(migrateProtectedText(value), row.id as number);
        }
      }
    }
    for (const [table, encryptedFields] of historyFields) {
      const selectedFields = encryptedFields.join(", ");
      const rows = database.prepare(`SELECT id, ${selectedFields}, recorded_at FROM ${table}`).all() as Array<Record<string, unknown>>;
      const setFields = [...encryptedFields.map((field) => `${field} = ?`), "recorded_at = ?", "recorded_at_hash = ?"].join(", ");
      const update = database.prepare(`UPDATE ${table} SET ${setFields} WHERE id = ?`);
      for (const row of rows) {
        const storedTime = String(row.recorded_at);
        const recordedAt = isProtectedStoredText(storedTime) ? unprotectStoredText(storedTime) : storedTime;
        update.run(
          ...encryptedFields.map((field) => protectedValue(row[field])),
          protectedValue(recordedAt),
          timestampHash(recordedAt),
          row.id as number
        );
      }
    }
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS weight_history_user_time_hash ON weight_history(user_id, recorded_at_hash);
      CREATE UNIQUE INDEX IF NOT EXISTS activity_history_user_time_hash ON activity_history(user_id, recorded_at_hash);
      CREATE UNIQUE INDEX IF NOT EXISTS analytics_history_user_time_hash ON analytics_history(user_id, recorded_at_hash);
    `);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function migrateRecommendationHistory(): void {
  const cached = database
    .prepare("SELECT user_id, recommendation_json, generated_at FROM recommendation_cache WHERE user_id IS NOT NULL")
    .all() as Array<{ user_id: number; recommendation_json: string; generated_at: string }>;
  const exists = database.prepare("SELECT id FROM recommendation_history WHERE user_id = ? AND generated_at_hash = ? LIMIT 1");
  const insert = database.prepare("INSERT INTO recommendation_history (user_id, recommendation_json, generated_at, generated_at_hash, source) VALUES (?, ?, ?, ?, ?)");
  for (const row of cached) {
    const generatedAt = unprotectStoredText(row.generated_at);
    const guidance = JSON.parse(unprotectStoredText(row.recommendation_json)) as Guidance;
    if (exists.get(row.user_id, timestampHash(generatedAt))) {
      continue;
    }
    insert.run(
      row.user_id,
      protectedValue(JSON.stringify(guidance)),
      protectedValue(generatedAt),
      timestampHash(generatedAt),
      guidance.source
    );
  }
}

migrateLegacyStorage();
migrateProtectedStorage();
migrateRecommendationHistory();

function readProfile(userId: number): HealthProfile | null {
  const row = database
    .prepare("SELECT profile_json FROM profile WHERE user_id = ?")
    .get(userId) as { profile_json?: string } | undefined;
  return row?.profile_json ? (JSON.parse(unprotectStoredText(row.profile_json)) as HealthProfile) : null;
}

function readPrivacy(userId: number): PrivacySettings | null {
  const row = database
    .prepare("SELECT settings_json FROM privacy_settings WHERE user_id = ?")
    .get(userId) as { settings_json?: string } | undefined;
  return row?.settings_json ? (JSON.parse(unprotectStoredText(row.settings_json)) as PrivacySettings) : null;
}

function nextUniqueTime(userId: number, value: string, table: "weight_history" | "activity_history" | "analytics_history"): string {
  let candidate = value;
  let offset = 0;
  const query = database.prepare(`SELECT id FROM ${table} WHERE user_id = ? AND recorded_at_hash = ?`);
  while (query.get(userId, timestampHash(candidate))) {
    offset += 1;
    candidate = new Date(new Date(value).getTime() + offset).toISOString();
  }
  return candidate;
}

function addWeight(userId: number, weightKg: number, recordedAt: string): void {
  const uniqueTime = nextUniqueTime(userId, recordedAt, "weight_history");
  database.prepare("INSERT INTO weight_history (user_id, weight_kg, recorded_at, recorded_at_hash) VALUES (?, ?, ?, ?)")
    .run(userId, protectStoredText(String(weightKg)), protectStoredText(uniqueTime), timestampHash(uniqueTime));
}

function addAnalytics(userId: number, profile: HealthProfile, recordedAt: string): void {
  const uniqueTime = nextUniqueTime(userId, recordedAt, "analytics_history");
  database
    .prepare("INSERT INTO analytics_history (user_id, wellness_score, bmi, bmi_score, activity_score, goal_progress, habits_score, recorded_at, recorded_at_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      userId,
      protectStoredText(String(profile.analytics.wellnessScore)),
      protectStoredText(String(profile.analytics.bmi)),
      protectStoredText(String(profile.analytics.bmiScore)),
      protectStoredText(String(profile.analytics.activityScore)),
      protectStoredText(String(profile.analytics.goalProgress)),
      protectStoredText(String(profile.analytics.habitsScore)),
      protectStoredText(uniqueTime),
      timestampHash(uniqueTime)
    );
}

function parseActivity(input: unknown): ActivityInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new HistoryValidationError("Activity data must be an object.");
  }
  const value = input as Record<string, unknown>;
  const activeDays = value.activeDays;
  const recordedAt = value.recordedAt;
  if (
    typeof activeDays !== "number" ||
    !Number.isInteger(activeDays) ||
    activeDays < 0 ||
    activeDays > 7
  ) {
    throw new HistoryValidationError("Active days must be a whole number from 0 to 7.");
  }
  if (typeof recordedAt !== "string" || !Number.isFinite(Date.parse(recordedAt))) {
    throw new HistoryValidationError("A valid activity time is required.");
  }
  return { activeDays, recordedAt: new Date(recordedAt).toISOString() };
}

export function getProfile(userId: number): HealthProfile | null {
  return readProfile(userId);
}

export function getPrivacy(userId: number): PrivacySettings | null {
  return readPrivacy(userId);
}

export function getHistory(userId: number): HealthHistory {
  const weights = database
    .prepare("SELECT id, weight_kg, recorded_at FROM weight_history WHERE user_id = ? ORDER BY id DESC")
    .all(userId) as Array<{ id: number; weight_kg: string; recorded_at: string }>;
  const activities = database
    .prepare("SELECT id, active_days, recorded_at FROM activity_history WHERE user_id = ? ORDER BY id DESC")
    .all(userId) as Array<{ id: number; active_days: string; recorded_at: string }>;
  const analytics = database
    .prepare("SELECT id, wellness_score, bmi, bmi_score, activity_score, goal_progress, habits_score, recorded_at FROM analytics_history WHERE user_id = ? ORDER BY id DESC")
    .all(userId) as Array<{
    id: number;
    wellness_score: string;
    bmi: string;
    bmi_score: string;
    activity_score: string;
    goal_progress: string;
    habits_score: string;
    recorded_at: string;
  }>;
  return {
    weights: weights.map((item) => ({ id: item.id, weightKg: Number(unprotectStoredText(item.weight_kg)), recordedAt: unprotectStoredText(item.recorded_at) })),
    activities: activities.map((item) => ({ id: item.id, activeDays: Number(unprotectStoredText(item.active_days)), recordedAt: unprotectStoredText(item.recorded_at) })),
    analytics: analytics.map((item) => ({
      id: item.id,
      wellnessScore: Number(unprotectStoredText(item.wellness_score)),
      bmi: Number(unprotectStoredText(item.bmi)),
      bmiScore: Number(unprotectStoredText(item.bmi_score)),
      activityScore: Number(unprotectStoredText(item.activity_score)),
      goalProgress: Number(unprotectStoredText(item.goal_progress)),
      habitsScore: Number(unprotectStoredText(item.habits_score)),
      recordedAt: unprotectStoredText(item.recorded_at)
    }))
  };
}

export function getRecommendations(userId: number): Guidance | null {
  const row = database
    .prepare("SELECT recommendation_json FROM recommendation_cache WHERE user_id = ?")
    .get(userId) as { recommendation_json?: string } | undefined;
  if (row?.recommendation_json) {
    return JSON.parse(unprotectStoredText(row.recommendation_json)) as Guidance;
  }
  const profile = getProfile(userId);
  if (!profile) {
    return null;
  }
  const guidance = buildLocalGuidance(profile, getHistory(userId));
  saveRecommendations(guidance, userId);
  return guidance;
}

export function saveRecommendations(guidance: Guidance, userId: number): void {
  database
    .prepare("INSERT INTO recommendation_cache (user_id, recommendation_json, generated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET recommendation_json = excluded.recommendation_json, generated_at = excluded.generated_at")
    .run(userId, protectStoredText(JSON.stringify(guidance)), protectStoredText(guidance.generatedAt));
  database
    .prepare("INSERT INTO recommendation_history (user_id, recommendation_json, generated_at, generated_at_hash, source) VALUES (?, ?, ?, ?, ?)")
    .run(
      userId,
      protectStoredText(JSON.stringify(guidance)),
      protectStoredText(guidance.generatedAt),
      timestampHash(guidance.generatedAt),
      guidance.source
    );
  database
    .prepare("DELETE FROM recommendation_history WHERE user_id = ? AND id NOT IN (SELECT id FROM recommendation_history WHERE user_id = ? ORDER BY id DESC LIMIT 50)")
    .run(userId, userId);
}

export function getRecommendationHistory(userId: number): RecommendationHistoryRecord[] {
  const rows = database
    .prepare("SELECT id, recommendation_json, generated_at, source FROM recommendation_history WHERE user_id = ? ORDER BY id DESC LIMIT 50")
    .all(userId) as Array<{ id: number; recommendation_json: string; generated_at: string; source: string }>;
  return rows.map((row) => ({
    version: row.id,
    generatedAt: unprotectStoredText(row.generated_at),
    source: row.source === "deepseek" ? "deepseek" : "local",
    guidance: JSON.parse(unprotectStoredText(row.recommendation_json)) as Guidance
  }));
}

export function saveProfile(input: unknown, userId: number): HealthProfile {
  // One transaction keeps the profile, privacy settings, history, and guidance in sync.
  const previousPrivacy = readPrivacy(userId);
  const value = typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const privacy = parsePrivacy(value.privacy, previousPrivacy?.consentedAt);
  const profile = buildProfile(input);
  database.exec("BEGIN");
  try {
    database
      .prepare("INSERT INTO profile (user_id, profile_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET profile_json = excluded.profile_json, updated_at = excluded.updated_at")
      .run(userId, protectStoredText(JSON.stringify(profile)), protectStoredText(profile.updatedAt));
    database
      .prepare("INSERT INTO privacy_settings (user_id, settings_json, consented_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, consented_at = excluded.consented_at")
      .run(userId, protectStoredText(JSON.stringify(privacy)), protectStoredText(privacy.consentedAt));
    addWeight(userId, profile.weightKg, profile.updatedAt);
    addAnalytics(userId, profile, profile.updatedAt);
    saveRecommendations(buildLocalGuidance(profile, getHistory(userId)), userId);
    database.exec("COMMIT");
    return profile;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function addActivity(input: unknown, userId: number): HealthHistory {
  const activity = parseActivity(input);
  const existing = database
    .prepare("SELECT id FROM activity_history WHERE user_id = ? AND recorded_at_hash = ?")
    .get(userId, timestampHash(activity.recordedAt));
  if (existing) {
    throw new DuplicateActivityError();
  }
  database
    .prepare("INSERT INTO activity_history (user_id, active_days, recorded_at, recorded_at_hash) VALUES (?, ?, ?, ?)")
    .run(
      userId,
      protectStoredText(String(activity.activeDays)),
      protectStoredText(activity.recordedAt),
      timestampHash(activity.recordedAt)
    );
  const history = getHistory(userId);
  const profile = getProfile(userId);
  if (profile) {
    saveRecommendations(buildLocalGuidance(profile, history), userId);
  }
  return history;
}

export function exportData(userId: number): {
  exportedAt: string;
  profile: HealthProfile | null;
  privacy: PrivacySettings | null;
  history: HealthHistory;
  recommendationHistory: RecommendationHistoryRecord[];
} {
  return {
    exportedAt: new Date().toISOString(),
    profile: getProfile(userId),
    privacy: getPrivacy(userId),
    history: getHistory(userId),
    recommendationHistory: getRecommendationHistory(userId)
  };
}
