import { buildProfile, parsePrivacy, type HealthProfile, type PrivacySettings } from "./profile.js";
import { buildLocalGuidance, type Guidance } from "./recommendations.js";

interface WeightRecord {
  id: number;
  weightKg: number;
  recordedAt: string;
}

interface ActivityRecord {
  id: number;
  activeDays: number;
  recordedAt: string;
}

interface AnalyticsRecord {
  id: number;
  wellnessScore: number;
  bmi: number;
  bmiScore: number;
  activityScore: number;
  goalProgress: number;
  habitsScore: number;
  recordedAt: string;
}

export interface GuestHistory {
  weights: WeightRecord[];
  activities: ActivityRecord[];
  analytics: AnalyticsRecord[];
}

export class GuestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestValidationError";
  }
}

export class GuestDuplicateActivityError extends Error {
  constructor() {
    super("An activity record already exists for this time.");
    this.name = "GuestDuplicateActivityError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validNumber(value: unknown, minimum: number, maximum: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new GuestValidationError("Stored guest history is not valid.");
  }
  if (integer && !Number.isInteger(value)) {
    throw new GuestValidationError("Stored guest history is not valid.");
  }
  return value;
}

function validId(value: unknown): number {
  return validNumber(value, 1, Number.MAX_SAFE_INTEGER, true);
}

function validTime(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new GuestValidationError("Stored guest history is not valid.");
  }
  return new Date(value).toISOString();
}

function historyItems(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new GuestValidationError("Stored guest history is not valid.");
  }
  return value;
}

function parseHistory(value: unknown): GuestHistory {
  if (!isRecord(value)) {
    return { weights: [], activities: [], analytics: [] };
  }
  return {
    weights: historyItems(value.weights).map((item) => {
      if (!isRecord(item)) throw new GuestValidationError("Stored guest history is not valid.");
      return { id: validId(item.id), weightKg: validNumber(item.weightKg, 20, 400), recordedAt: validTime(item.recordedAt) };
    }),
    activities: historyItems(value.activities).map((item) => {
      if (!isRecord(item)) throw new GuestValidationError("Stored guest history is not valid.");
      return { id: validId(item.id), activeDays: validNumber(item.activeDays, 0, 7, true), recordedAt: validTime(item.recordedAt) };
    }),
    analytics: historyItems(value.analytics).map((item) => {
      if (!isRecord(item)) throw new GuestValidationError("Stored guest history is not valid.");
      const bmi = validNumber(item.bmi, 1, 200);
      const derivedBmiScore = Math.round(Math.max(0, Math.min(100, 100 - Math.abs(bmi - 22) * 5)));
      return {
        id: validId(item.id),
        wellnessScore: validNumber(item.wellnessScore, 0, 100),
        bmi,
        bmiScore: validNumber(item.bmiScore ?? derivedBmiScore, 0, 100),
        activityScore: validNumber(item.activityScore, 0, 100),
        goalProgress: validNumber(item.goalProgress, 0, 100),
        habitsScore: validNumber(item.habitsScore, 0, 100),
        recordedAt: validTime(item.recordedAt)
      };
    })
  };
}

function nextId(items: Array<{ id: number }>): number {
  return items.reduce((largest, item) => Math.max(largest, item.id), 0) + 1;
}

function uniqueTime(value: string, items: Array<{ recordedAt: string }>): string {
  const times = new Set(items.map((item) => item.recordedAt));
  let candidate = value;
  let offset = 0;
  while (times.has(candidate)) {
    offset += 1;
    candidate = new Date(Date.parse(value) + offset).toISOString();
  }
  return candidate;
}

function profileHistory(profile: HealthProfile, history: GuestHistory): GuestHistory {
  const weightTime = uniqueTime(profile.updatedAt, history.weights);
  const analyticsTime = uniqueTime(profile.updatedAt, history.analytics);
  return {
    weights: [{ id: nextId(history.weights), weightKg: profile.weightKg, recordedAt: weightTime }, ...history.weights].slice(0, 100),
    activities: history.activities,
    analytics: [{
      id: nextId(history.analytics),
      wellnessScore: profile.analytics.wellnessScore,
      bmi: profile.analytics.bmi,
      bmiScore: profile.analytics.bmiScore,
      activityScore: profile.analytics.activityScore,
      goalProgress: profile.analytics.goalProgress,
      habitsScore: profile.analytics.habitsScore,
      recordedAt: analyticsTime
    }, ...history.analytics].slice(0, 100)
  };
}

function requestParts(input: unknown): { value: Record<string, unknown>; history: GuestHistory; privacy: PrivacySettings } {
  if (!isRecord(input) || !isRecord(input.profile)) {
    throw new GuestValidationError("Guest profile data must be an object.");
  }
  const previousConsent = isRecord(input.privacy) && typeof input.privacy.consentedAt === "string" && Number.isFinite(Date.parse(input.privacy.consentedAt))
    ? new Date(input.privacy.consentedAt).toISOString()
    : undefined;
  return {
    value: input,
    history: parseHistory(input.history),
    privacy: parsePrivacy(input.privacy, previousConsent)
  };
}

export function saveGuestProfile(input: unknown): {
  profile: HealthProfile;
  privacy: PrivacySettings;
  history: GuestHistory;
  recommendations: Guidance;
} {
  const { value, history, privacy } = requestParts(input);
  const profile = buildProfile(value.profile);
  const updatedHistory = profileHistory(profile, history);
  return { profile, privacy, history: updatedHistory, recommendations: buildLocalGuidance(profile, updatedHistory) };
}

export function saveGuestActivity(input: unknown): { history: GuestHistory; recommendations: Guidance } {
  const { value, history } = requestParts(input);
  const profile = buildProfile(value.profile);
  const activeDays = validNumber(value.activeDays, 0, 7, true);
  const recordedAt = validTime(value.recordedAt);
  if (history.activities.some((item) => item.recordedAt === recordedAt)) {
    throw new GuestDuplicateActivityError();
  }
  const updatedHistory = {
    ...history,
    activities: [{ id: nextId(history.activities), activeDays, recordedAt }, ...history.activities].slice(0, 100)
  };
  const stableProfile = isRecord(value.profile) && typeof value.profile.updatedAt === "string" && Number.isFinite(Date.parse(value.profile.updatedAt))
    ? { ...profile, updatedAt: new Date(value.profile.updatedAt).toISOString() }
    : profile;
  return { history: updatedHistory, recommendations: buildLocalGuidance(stableProfile, updatedHistory) };
}
