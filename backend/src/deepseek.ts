import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { containsPersonalIdentifier, type HealthProfile } from "./profile.js";
import { buildGroundedSummaries, type Guidance, type GuidanceHistory, type RecommendationItem, type RecommendationPriority } from "./recommendations.js";

interface DeepSeekConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

interface ParsedModelResponse {
  guidance: Guidance | null;
  correction: string;
}

export type DeepSeekFailureCode =
  | "not_configured"
  | "provider_rejected"
  | "rate_limited"
  | "timed_out"
  | "invalid_response"
  | "unavailable";

export class DeepSeekGenerationError extends Error {
  constructor(
    public readonly code: DeepSeekFailureCode,
    message: string,
    public readonly status: number,
    public readonly providerStatus?: number
  ) {
    super(message);
    this.name = "DeepSeekGenerationError";
  }
}

function loadEnvFile(path: string, accepts = (_name: string) => true): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/u)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line);
    if (!match || !accepts(match[1]) || process.env[match[1]]) {
      continue;
    }
    const value = match[2].replace(/^(['"])(.*)\1$/u, "$2");
    process.env[match[1]] = value;
  }
}

function loadLocalEnv(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "..", ".env")];
  for (const path of candidates) {
    if (existsSync(path)) {
      loadEnvFile(path);
    }
  }
  const externalEnvFile = process.env.DEEPSEEK_ENV_FILE?.trim();
  if (externalEnvFile && existsSync(resolve(externalEnvFile))) {
    loadEnvFile(resolve(externalEnvFile), (name) => name.startsWith("DEEPSEEK_"));
  }
}

loadLocalEnv();

function getConfig(): DeepSeekConfig | null {
  const keyFile = process.env.DEEPSEEK_API_KEY_FILE?.trim();
  let apiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
  if (keyFile) {
    try {
      apiKey = readFileSync(resolve(keyFile), "utf8").trim();
    } catch {
      return null;
    }
  }
  const model = process.env.DEEPSEEK_MODEL?.trim() ?? "";
  if (!apiKey || !model) {
    return null;
  }
  const timeoutValue = Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 55000);
  return {
    apiKey,
    baseUrl: (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/$/u, ""),
    model,
    timeoutMs: Number.isInteger(timeoutValue) && timeoutValue >= 1000 && timeoutValue <= 120000 ? timeoutValue : 55000
  };
}

export function deepSeekConfigStatus(): { configured: boolean; baseUrl: string | null; modelConfigured: boolean } {
  const config = getConfig();
  return {
    configured: config !== null,
    baseUrl: config?.baseUrl ?? null,
    modelConfigured: config?.model.length ? true : Boolean(process.env.DEEPSEEK_MODEL?.trim())
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    return null;
  }
  // Tabs and line breaks are valid text. Other control characters are rejected.
  const hasUnsafeControl = Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  });
  if (hasUnsafeControl || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)) {
    return null;
  }
  return value.trim();
}

const restrictionAliases: Record<string, string[]> = {
  dairy: ["milk", "cheese", "yogurt", "butter", "cream", "whey", "casein"],
  gluten: ["gluten", "wheat", "barley", "rye", "bread", "pasta"],
  peanut: ["peanut", "peanuts"],
  peanuts: ["peanut", "peanuts"],
  nut: ["peanut", "almond", "cashew", "walnut", "hazelnut", "pistachio", "pecan"],
  nuts: ["peanut", "almond", "cashew", "walnut", "hazelnut", "pistachio", "pecan"],
  egg: ["egg", "eggs"],
  eggs: ["egg", "eggs"],
  vegetarian: ["meat", "chicken", "beef", "pork", "fish"],
  vegan: ["meat", "chicken", "beef", "pork", "fish", "milk", "cheese", "yogurt", "butter", "egg", "eggs"]
};

function normalizedRestriction(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b(allergy|allergic to|intolerance|free)\b/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function termPattern(term: string): RegExp {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "giu");
}

function safeRestrictionContext(text: string, index: number, length: number): boolean {
  const prefix = text.slice(Math.max(0, index - 48), index).toLowerCase();
  const suffix = text.slice(index + length, index + length + 24).toLowerCase();
  return /\b(avoid|without|exclude|skip|limit|restriction|allergy|allergic|do not|don't|free from|respect)\b/gu.test(prefix)
    || /^\s+(restriction|allergy|intolerance)\b/gu.test(suffix);
}

export function conflictsWithDietaryRestrictions(text: string, restrictions: string[]): boolean {
  for (const restriction of restrictions) {
    const normalized = normalizedRestriction(restriction);
    if (!normalized) {
      continue;
    }
    const terms = restrictionAliases[normalized] ?? [normalized];
    for (const term of terms) {
      for (const match of text.matchAll(termPattern(term))) {
        if (match.index !== undefined && !safeRestrictionContext(text, match.index, match[0].length)) {
          return true;
        }
      }
    }
  }
  return false;
}

function formatGoal(value: HealthProfile["fitnessGoal"]): string {
  const label = value.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function withGoal(value: string, profile: HealthProfile): string {
  const text = withoutGoalPrefix(value);
  return `Goal: ${formatGoal(profile.fitnessGoal)}. ${text}`;
}

function withoutGoalPrefix(value: string): string {
  let text = value.trim();
  for (let count = 0; count < 3; count += 1) {
    const next = text.replace(/^Goal:\s*[^.]+\.\s*/iu, "").trim();
    if (next === text) {
      break;
    }
    text = next;
  }
  return text;
}

function hasUnsupportedHistoryClaim(value: string): boolean {
  const normalized = value.toLowerCase().replaceAll("’", "'");
  return /\byou(?:'ve| have)?\s+(?:been|lost|gained|increased|decreased|improved|completed|maintained|reached|achieved)\b/u.test(normalized)
    || /\byou\s+(?:were|was|lost|gained|increased|decreased|improved|completed|maintained|reached|achieved)\b/u.test(normalized)
    || /\byour\s+(?:weight|activity|wellness|score|progress|endurance|strength)\s+(?:has|have|had|increased|decreased|improved|changed)\b/u.test(normalized)
    || /\b(?:over|during|for)\s+(?:the\s+)?(?:last|past|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?|years?)\b/u.test(normalized);
}

function safeSummaryFocus(value: unknown): string | null {
  const text = safeText(value, 500);
  if (!text || hasUnsupportedHistoryClaim(text) || /\d/u.test(text)) {
    return null;
  }
  const focus = withoutGoalPrefix(text);
  if (!focus) {
    return null;
  }
  return /[.!?]$/u.test(focus) ? focus : `${focus}.`;
}

function rejectedModelResponse(correction: string): ParsedModelResponse {
  return { guidance: null, correction };
}

function parseModelResponse(value: unknown, profile: HealthProfile, history: GuidanceHistory): ParsedModelResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return rejectedModelResponse("Return an items array at the top level.");
  }
  const items: RecommendationItem[] = [];
  for (const item of value.items.slice(0, 4)) {
    if (!isRecord(item)) {
      return rejectedModelResponse("Every item must be an object.");
    }
    const priority = item.priority;
    const title = safeText(item.title, 80);
    const text = safeText(item.text, 500);
    if (
      (priority !== "high" && priority !== "medium" && priority !== "low") ||
      !title ||
      !text
    ) {
      return rejectedModelResponse("Every item must have a lowercase priority, a short title, and a short text value.");
    }
    if (hasUnsupportedHistoryClaim(`${title}. ${text}`)) {
      continue;
    }
    if (conflictsWithDietaryRestrictions(`${title}. ${text}`, profile.dietaryRestrictions)) {
      continue;
    }
    items.push({
      id: `deepseek-${items.length + 1}`,
      priority: priority as RecommendationPriority,
      title,
      text: withGoal(text, profile)
    });
  }
  const weeklyCandidate = safeText(value.weekly, 500);
  const monthlyCandidate = safeText(value.monthly, 500);
  if (items.length === 0) {
    return rejectedModelResponse("Return at least one item without progress claims or restricted foods.");
  }
  if (!weeklyCandidate) {
    return rejectedModelResponse("Return weekly as a non-empty string under 500 characters.");
  }
  if (!monthlyCandidate) {
    return rejectedModelResponse("Return monthly as a non-empty string under 500 characters.");
  }
  if (
    conflictsWithDietaryRestrictions(weeklyCandidate, profile.dietaryRestrictions) ||
    conflictsWithDietaryRestrictions(monthlyCandidate, profile.dietaryRestrictions)
  ) {
    return rejectedModelResponse("Remove restricted foods from weekly and monthly.");
  }
  const grounded = buildGroundedSummaries(profile, history);
  const weeklyFocus = safeSummaryFocus(weeklyCandidate);
  const monthlyFocus = safeSummaryFocus(monthlyCandidate);
  return {
    correction: "",
    guidance: {
      generatedAt: new Date().toISOString(),
      profileUpdatedAt: profile.updatedAt,
      source: "deepseek",
      goal: formatGoal(profile.fitnessGoal),
      items,
      summaries: {
        weekly: weeklyFocus ? `${grounded.weekly} ${weeklyFocus}` : grounded.weekly,
        monthly: monthlyFocus ? `${grounded.monthly} ${monthlyFocus}` : grounded.monthly
      }
    }
  };
}

function promptData(profile: HealthProfile, history: GuidanceHistory): Record<string, unknown> {
  // This object contains health fields only. It does not contain a name or email.
  return {
    current_state: {
      age: profile.age,
      height_cm: profile.heightCm,
      weight_kg: profile.weightKg,
      bmi: profile.analytics.bmi,
      activity_level: profile.activityLevel,
      weekly_activity_days: profile.weeklyActivityDays
    },
    target_state: {
      weight_kg: profile.targetWeightKg ?? null,
      fitness_goal: profile.fitnessGoal
    },
    fitness: {
      exercise_types: profile.exerciseTypes,
      session_duration: profile.sessionDuration,
      fitness_level: profile.fitnessLevel,
      exercise_environment: profile.exerciseEnvironment,
      exercise_time: profile.exerciseTime,
      endurance_minutes: profile.enduranceMinutes,
      pushups: profile.pushups,
      squats: profile.squats
    },
    preferences: profile.dietaryPreferences.filter((value) => !containsPersonalIdentifier(value)),
    restrictions: profile.dietaryRestrictions.filter((value) => !containsPersonalIdentifier(value)),
    history: {
      weights: history.weights.slice(0, 12),
      activities: history.activities.slice(0, 12),
      analytics: history.analytics?.slice(0, 12) ?? []
    }
  };
}

function invalidResponseError(): DeepSeekGenerationError {
  return new DeepSeekGenerationError(
    "invalid_response",
    "Online AI did not return usable guidance. Try again. Local guidance is still available.",
    502
  );
}

function providerResponseError(status: number): DeepSeekGenerationError {
  if (status === 429) {
    return new DeepSeekGenerationError(
      "rate_limited",
      "Online AI is busy. Try again in a few minutes. Local guidance is still available.",
      429,
      status
    );
  }
  if (status === 401 || status === 403) {
    return new DeepSeekGenerationError(
      "provider_rejected",
      "Online AI is not available. Local guidance is still available.",
      503,
      status
    );
  }
  return new DeepSeekGenerationError(
    "unavailable",
    "Online AI is not available now. Try again later. Local guidance is still available.",
    status >= 500 ? 503 : 502,
    status
  );
}

const guidanceSystemPrompt = "Return one JSON object with items, weekly, and monthly. Return 1 to 4 items. Each item must contain priority, title, and text. Priority must be high, medium, or low in lowercase. Keep each title under 80 characters and each text under 500 characters. Items must be practical actions based on the supplied goal and profile. Do not state what the user did, changed, lost, gained, or completed. One activity record is not proof of a repeating routine. Weekly and monthly must each contain one qualitative focus with no numbers, dates, measurements, or progress claims. The app adds calculated progress facts. Do not diagnose. Do not include names, emails, or other identifiers. Do not recommend ingredients listed in restrictions. Do not use a code block.";

async function requestDeepSeekGuidance(
  config: DeepSeekConfig,
  profile: HealthProfile,
  history: GuidanceHistory,
  signal: AbortSignal,
  correction = ""
): Promise<ParsedModelResponse> {
  const correctionText = correction
    ? ` The previous response was rejected. ${correction} Return only the corrected JSON object.`
    : "";
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: correction ? 0.1 : 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${guidanceSystemPrompt}${correctionText}`
        },
        {
          role: "user",
          content: JSON.stringify(promptData(profile, history))
        }
      ]
    }),
    signal
  });
  if (!response.ok) {
    throw providerResponseError(response.status);
  }
  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    return rejectedModelResponse("Return valid JSON.");
  }
  if (!isRecord(body) || !Array.isArray(body.choices)) {
    return rejectedModelResponse("Return one response choice with a message.");
  }
  const first = body.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    return rejectedModelResponse("Return one response choice with a message.");
  }
  const content = safeText(first.message.content, 5000);
  if (!content) {
    return rejectedModelResponse("Return the JSON object as message content.");
  }
  const jsonText = content.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return rejectedModelResponse("Return valid JSON without a code block.");
  }
  return parseModelResponse(parsed, profile, history);
}

export async function generateDeepSeekGuidance(profile: HealthProfile, history: GuidanceHistory): Promise<Guidance> {
  const config = getConfig();
  if (!config) {
    throw new DeepSeekGenerationError(
      "not_configured",
      "Online AI is not available. Local guidance is still available.",
      503
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const firstAttempt = await requestDeepSeekGuidance(config, profile, history, controller.signal);
    if (firstAttempt.guidance) {
      return firstAttempt.guidance;
    }
    const repairAttempt = await requestDeepSeekGuidance(
      config,
      profile,
      history,
      controller.signal,
      firstAttempt.correction
    );
    if (!repairAttempt.guidance) {
      throw invalidResponseError();
    }
    return repairAttempt.guidance;
  } catch (error) {
    if (error instanceof DeepSeekGenerationError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new DeepSeekGenerationError(
        "timed_out",
        "Online AI took too long to respond. Try again. Local guidance is still available.",
        504
      );
    }
    throw new DeepSeekGenerationError(
      "unavailable",
      "Online AI is not available now. Try again later. Local guidance is still available.",
      503
    );
  } finally {
    clearTimeout(timeout);
  }
}
