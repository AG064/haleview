import { randomUUID } from "node:crypto";
import { containsPersonalIdentifier } from "../profile.js";
import { protectStoredText, unprotectStoredText } from "../protected-data.js";
import { database } from "../storage.js";
import type { CommunityRecipeSignal } from "./types.js";

export type FeedbackSubject = "recipe" | "ingredient" | "suggestion" | "meal_plan";
export type FeedbackRating = "helpful" | "not_helpful";
export type FeedbackDecision = "accepted" | "rejected" | "saved" | "none";
export type FeedbackModerationStatus = "approved" | "rejected";

export interface NutritionFeedbackInput {
  subjectType: FeedbackSubject;
  subjectId: string;
  rating: FeedbackRating;
  decision: FeedbackDecision;
  comment?: string;
  stars?: number;
}

export interface NutritionFeedbackRecord extends NutritionFeedbackInput {
  id: string;
  comment: string;
  stars: number;
  moderationStatus: FeedbackModerationStatus;
  moderationReason: string;
  createdAt: string;
}

export interface NutritionFeedbackSummary {
  total: number;
  helpful: number;
  notHelpful: number;
  accepted: number;
  rejected: number;
  saved: number;
}

export class NutritionFeedbackError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "NutritionFeedbackError";
    this.status = status;
  }
}

database.exec(`
  CREATE TABLE IF NOT EXISTS nutrition_feedback (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    feedback_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS nutrition_feedback_user ON nutrition_feedback(user_id);
`);

function validUserId(userId: number): number {
  if (!Number.isInteger(userId) || userId <= 0) throw new NutritionFeedbackError("A signed-in account is required.", 401);
  return userId;
}

function validText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") throw new NutritionFeedbackError(`${field} must be text.`);
  const clean = value.trim();
  if (!clean || clean.length > maximum) throw new NutritionFeedbackError(`${field} has an invalid length.`);
  return clean;
}

function validComment(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.trim().length > 500) {
    throw new NutritionFeedbackError("Feedback comment must have at most 500 characters.");
  }
  const clean = value.trim();
  if (containsPersonalIdentifier(clean)) throw new NutritionFeedbackError("Feedback comments must not include contact details.");
  return clean;
}

function validStars(value: unknown, rating: FeedbackRating): number {
  if (value === undefined || value === null || value === "") return rating === "helpful" ? 5 : 1;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new NutritionFeedbackError("Recipe rating must be a whole number from 1 to 5.");
  }
  return value;
}

function moderationFor(comment: string): Pick<NutritionFeedbackRecord, "moderationStatus" | "moderationReason"> {
  if (!comment) {
    return { moderationStatus: "approved", moderationReason: "No public review text." };
  }
  if (/\p{C}/u.test(comment) || /(.)\1{9,}/u.test(comment)) {
    return { moderationStatus: "rejected", moderationReason: "The review did not pass the content checks." };
  }
  return { moderationStatus: "approved", moderationReason: "Passed privacy and content checks." };
}

function normaliseInput(input: NutritionFeedbackInput): NutritionFeedbackInput & { comment: string; stars: number } {
  if (!["recipe", "ingredient", "suggestion", "meal_plan"].includes(input.subjectType)) {
    throw new NutritionFeedbackError("Feedback subject is not supported.");
  }
  if (input.rating !== "helpful" && input.rating !== "not_helpful") {
    throw new NutritionFeedbackError("Feedback rating is not supported.");
  }
  if (!["accepted", "rejected", "saved", "none"].includes(input.decision)) {
    throw new NutritionFeedbackError("Feedback decision is not supported.");
  }
  return {
    subjectType: input.subjectType,
    subjectId: validText(input.subjectId, "Feedback subject id", 160),
    rating: input.rating,
    decision: input.decision,
    comment: validComment(input.comment),
    stars: validStars(input.stars, input.rating),
  };
}

function readFeedback(value: string): NutritionFeedbackRecord {
  const record = JSON.parse(unprotectStoredText(value)) as Partial<NutritionFeedbackRecord> & Pick<NutritionFeedbackRecord, "id" | "subjectType" | "subjectId" | "rating" | "decision" | "createdAt">;
  const comment = typeof record.comment === "string" ? record.comment : "";
  const moderation = moderationFor(comment);
  return {
    ...record,
    comment,
    stars: typeof record.stars === "number" ? record.stars : record.rating === "helpful" ? 5 : 1,
    moderationStatus: record.moderationStatus ?? moderation.moderationStatus,
    moderationReason: record.moderationReason ?? moderation.moderationReason,
  } as NutritionFeedbackRecord;
}

export function saveNutritionFeedback(
  userId: number,
  input: NutritionFeedbackInput,
  now: () => Date = () => new Date(),
): NutritionFeedbackRecord {
  const safeUserId = validUserId(userId);
  const clean = normaliseInput(input);
  const moderation = moderationFor(clean.comment);
  const record: NutritionFeedbackRecord = {
    ...clean,
    ...moderation,
    id: `feedback-${randomUUID()}`,
    createdAt: now().toISOString(),
  };
  const previous = listNutritionFeedback(safeUserId).filter((item) => item.subjectType === record.subjectType && item.subjectId === record.subjectId);
  for (const item of previous) {
    database.prepare("DELETE FROM nutrition_feedback WHERE id = ? AND user_id = ?").run(item.id, safeUserId);
  }
  database
    .prepare("INSERT INTO nutrition_feedback (id, user_id, feedback_json, created_at) VALUES (?, ?, ?, ?)")
    .run(record.id, safeUserId, protectStoredText(JSON.stringify(record)), protectStoredText(record.createdAt));
  database
    .prepare("DELETE FROM nutrition_feedback WHERE user_id = ? AND id NOT IN (SELECT id FROM nutrition_feedback WHERE user_id = ? ORDER BY rowid DESC LIMIT 100)")
    .run(safeUserId, safeUserId);
  return record;
}

export function listNutritionFeedback(userId: number, limit = 100): NutritionFeedbackRecord[] {
  const safeUserId = validUserId(userId);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new NutritionFeedbackError("Feedback limit must be from 1 to 100.");
  const rows = database
    .prepare("SELECT feedback_json FROM nutrition_feedback WHERE user_id = ? ORDER BY rowid DESC LIMIT ?")
    .all(safeUserId, limit) as Array<{ feedback_json: string }>;
  return rows.map((row) => readFeedback(row.feedback_json));
}

export function summariseNutritionFeedback(records: NutritionFeedbackRecord[]): NutritionFeedbackSummary {
  return records.reduce<NutritionFeedbackSummary>((summary, record) => ({
    total: summary.total + 1,
    helpful: summary.helpful + (record.rating === "helpful" ? 1 : 0),
    notHelpful: summary.notHelpful + (record.rating === "not_helpful" ? 1 : 0),
    accepted: summary.accepted + (record.decision === "accepted" ? 1 : 0),
    rejected: summary.rejected + (record.decision === "rejected" ? 1 : 0),
    saved: summary.saved + (record.decision === "saved" ? 1 : 0),
  }), { total: 0, helpful: 0, notHelpful: 0, accepted: 0, rejected: 0, saved: 0 });
}

interface StoredFeedbackRow {
  user_id: number;
  feedback_json: string;
}

function allFeedback(): Array<{ userId: number; record: NutritionFeedbackRecord }> {
  const rows = database.prepare("SELECT user_id, feedback_json FROM nutrition_feedback ORDER BY rowid DESC").all() as unknown as StoredFeedbackRow[];
  return rows.map((row) => ({ userId: row.user_id, record: readFeedback(row.feedback_json) }));
}

export function communityRecipeSignals(): CommunityRecipeSignal[] {
  const grouped = new Map<string, NutritionFeedbackRecord[]>();
  for (const { record } of allFeedback()) {
    if (record.subjectType !== "recipe" || record.moderationStatus !== "approved") continue;
    const records = grouped.get(record.subjectId) ?? [];
    records.push(record);
    grouped.set(record.subjectId, records);
  }
  return [...grouped.entries()].map(([recipeId, records]) => {
    const helpfulCount = records.filter((record) => record.rating === "helpful").length;
    const notHelpfulCount = records.length - helpfulCount;
    const averageStars = Math.round(records.reduce((total, record) => total + record.stars, 0) / records.length * 10) / 10;
    const helpfulRatio = helpfulCount / records.length;
    const score = Math.round((((averageStars - 1) / 4) * 0.7 + helpfulRatio * 0.3) * 1000) / 1000;
    return {
      recipeId,
      ratingCount: records.length,
      averageStars,
      helpfulCount,
      notHelpfulCount,
      score,
      verified: records.length >= 3 && averageStars >= 4 && helpfulRatio >= 2 / 3,
    };
  }).sort((left, right) => right.score - left.score || right.ratingCount - left.ratingCount || left.recipeId.localeCompare(right.recipeId));
}

export function userRecipePreferences(userId: number): { likedRecipeIds: string[]; dislikedRecipeIds: string[] } {
  const records = listNutritionFeedback(userId).filter((record) => record.subjectType === "recipe" && record.moderationStatus === "approved");
  return {
    likedRecipeIds: records.filter((record) => record.stars >= 4 || record.rating === "helpful").map((record) => record.subjectId),
    dislikedRecipeIds: records.filter((record) => record.stars <= 2 || record.rating === "not_helpful").map((record) => record.subjectId),
  };
}
