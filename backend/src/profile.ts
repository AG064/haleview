export const activityLevels = [
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active"
] as const;

export const fitnessGoals = ["weight_loss", "muscle_gain", "general_fitness"] as const;
export const exerciseTypes = ["cardio", "strength", "flexibility", "sports"] as const;
export const sessionDurations = ["15_30", "30_60", "60_plus"] as const;
export const fitnessLevels = ["beginner", "intermediate", "advanced"] as const;
export const exerciseEnvironments = ["home", "gym", "outdoors"] as const;
export const exerciseTimes = ["morning", "afternoon", "evening"] as const;

type ValueOf<T extends readonly string[]> = T[number];

export type ActivityLevel = ValueOf<typeof activityLevels>;
export type FitnessGoal = ValueOf<typeof fitnessGoals>;
export type ExerciseType = ValueOf<typeof exerciseTypes>;
export type SessionDuration = ValueOf<typeof sessionDurations>;
export type FitnessLevel = ValueOf<typeof fitnessLevels>;
export type ExerciseEnvironment = ValueOf<typeof exerciseEnvironments>;
export type ExerciseTime = ValueOf<typeof exerciseTimes>;

export const publicVisibilityValues = ["private", "summary"] as const;
export type PublicVisibility = ValueOf<typeof publicVisibilityValues>;

export interface PrivacySettings {
  consentGiven: boolean;
  dataForRecommendations: boolean;
  publicVisibility: PublicVisibility;
  emailNotifications: boolean;
  consentedAt: string;
}

export interface HealthProfileInput {
  displayName?: string;
  age: number;
  gender: string;
  heightCm: number;
  weightKg: number;
  targetWeightKg?: number;
  occupationType: string;
  activityLevel: ActivityLevel;
  dietaryPreferences: string[];
  dietaryRestrictions: string[];
  fitnessGoal: FitnessGoal;
  weeklyActivityDays: number;
  exerciseTypes: ExerciseType[];
  sessionDuration: SessionDuration;
  fitnessLevel: FitnessLevel;
  exerciseEnvironment: ExerciseEnvironment;
  exerciseTime: ExerciseTime;
  enduranceMinutes: number;
  pushups: number;
  squats: number;
}

export interface HealthAnalytics {
  bmi: number;
  bmiClassification: "underweight" | "normal" | "overweight" | "obese";
  bmiScore: number;
  activityScore: number;
  goalProgress: number;
  habitsScore: number;
  wellnessScore: number;
}

export interface HealthProfile extends HealthProfileInput {
  updatedAt: string;
  analytics: HealthAnalytics;
}

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileValidationError";
  }
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function parsePrivacy(input: unknown, previousConsentAt?: string): PrivacySettings {
  if (!isRecord(input)) {
    throw new ProfileValidationError("Confirm data use before saving.");
  }
  if (input.consentGiven !== true) {
    throw new ProfileValidationError("Confirm data use before saving.");
  }
  if (!isBoolean(input.dataForRecommendations) || !isBoolean(input.emailNotifications)) {
    throw new ProfileValidationError("Choose the data and email settings before saving.");
  }
  const publicVisibility = input.publicVisibility;
  if (typeof publicVisibility !== "string" || !publicVisibilityValues.includes(publicVisibility as PublicVisibility)) {
    throw new ProfileValidationError("Choose a valid public visibility setting.");
  }
  return {
    consentGiven: true,
    dataForRecommendations: input.dataForRecommendations,
    publicVisibility: publicVisibility as PublicVisibility,
    emailNotifications: input.emailNotifications,
    consentedAt: previousConsentAt ?? new Date().toISOString()
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(input: Record<string, unknown>, key: string, maxLength = 80): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new ProfileValidationError(`${key} must be a non-empty string with at most ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalString(input: Record<string, unknown>, key: string, maxLength = 80): string {
  const value = input[key];
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new ProfileValidationError(`${key} must have at most ${maxLength} characters.`);
  }
  return value.trim();
}

function numberInRange(
  input: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  integer = false
): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ProfileValidationError(`${key} must be between ${minimum} and ${maximum}.`);
  }
  if (integer && !Number.isInteger(value)) {
    throw new ProfileValidationError(`${key} must be a whole number.`);
  }
  return value;
}

function optionalNumberInRange(
  input: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (input[key] === undefined || input[key] === null || input[key] === "") {
    return undefined;
  }
  return numberInRange(input, key, minimum, maximum);
}

function enumValue<T extends readonly string[]>(
  input: Record<string, unknown>,
  key: string,
  allowed: T
): T[number] {
  const value = input[key];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ProfileValidationError(`${key} contains an unsupported value.`);
  }
  return value as T[number];
}

function enumList<T extends readonly string[]>(
  input: Record<string, unknown>,
  key: string,
  allowed: T
): T[number][] {
  const value = input[key];
  if (!Array.isArray(value) || value.length > allowed.length) {
    throw new ProfileValidationError(`${key} must be a list of supported values.`);
  }
  const unique = [...new Set(value)];
  if (unique.some((item) => typeof item !== "string" || !allowed.includes(item))) {
    throw new ProfileValidationError(`${key} contains an unsupported value.`);
  }
  return unique as T[number][];
}

export function containsPersonalIdentifier(value: string): boolean {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)
    || /\b(?:https?:\/\/|www\.)\S+/iu.test(value)
    || /(?:\+?\d[\d\s().-]{7,}\d)/u.test(value);
}

function stringList(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value) || value.length > 20) {
    throw new ProfileValidationError(`${key} must contain at most 20 values.`);
  }
  const unique = [...new Set(value)];
  if (
    unique.some(
      (item) => typeof item !== "string" || item.trim().length === 0 || item.trim().length > 40
    )
  ) {
    throw new ProfileValidationError(`${key} contains an invalid value.`);
  }
  if (unique.some((item) => containsPersonalIdentifier(item))) {
    throw new ProfileValidationError(`${key} must not include contact details.`);
  }
  return unique.map((item) => item.trim());
}

export function parseProfile(input: unknown): HealthProfileInput {
  if (!isRecord(input)) {
    throw new ProfileValidationError("Profile payload must be an object.");
  }

  const displayName = optionalString(input, "displayName", 60);
  if (displayName && !/^[\p{L}\p{M}][\p{L}\p{M} .'\u2019-]*$/u.test(displayName)) {
    throw new ProfileValidationError("Name must contain letters, spaces, apostrophes or hyphens.");
  }
  return {
    ...(displayName ? { displayName } : {}),
    age: numberInRange(input, "age", 1, 120, true),
    gender: requiredString(input, "gender", 40),
    heightCm: numberInRange(input, "heightCm", 50, 250),
    weightKg: numberInRange(input, "weightKg", 20, 400),
    targetWeightKg: optionalNumberInRange(input, "targetWeightKg", 20, 400),
    occupationType: optionalString(input, "occupationType", 80),
    activityLevel: enumValue(input, "activityLevel", activityLevels),
    dietaryPreferences: stringList(input, "dietaryPreferences"),
    dietaryRestrictions: stringList(input, "dietaryRestrictions"),
    fitnessGoal: enumValue(input, "fitnessGoal", fitnessGoals),
    weeklyActivityDays: numberInRange(input, "weeklyActivityDays", 0, 7, true),
    exerciseTypes: enumList(input, "exerciseTypes", exerciseTypes),
    sessionDuration: enumValue(input, "sessionDuration", sessionDurations),
    fitnessLevel: enumValue(input, "fitnessLevel", fitnessLevels),
    exerciseEnvironment: enumValue(input, "exerciseEnvironment", exerciseEnvironments),
    exerciseTime: enumValue(input, "exerciseTime", exerciseTimes),
    enduranceMinutes: numberInRange(input, "enduranceMinutes", 0, 1000, true),
    pushups: numberInRange(input, "pushups", 0, 1000, true),
    squats: numberInRange(input, "squats", 0, 1000, true)
  };
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function bmiClassification(bmi: number): HealthAnalytics["bmiClassification"] {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}

function habitsScore(profile: HealthProfileInput): number {
  const exerciseScore = Math.min(profile.exerciseTypes.length * 12, 36);
  const fitnessScore = profile.fitnessLevel === "advanced" ? 24 : profile.fitnessLevel === "intermediate" ? 16 : 8;
  const consistencyScore = Math.min(profile.weeklyActivityDays * 4, 28);
  return Math.round(clamp(12 + exerciseScore + fitnessScore + consistencyScore));
}

const activityLevelScores: Record<ActivityLevel, number> = {
  sedentary: 0,
  light: 25,
  moderate: 50,
  active: 75,
  very_active: 100
};

export function calculateAnalytics(profile: HealthProfileInput): HealthAnalytics {
  const heightMetres = profile.heightCm / 100;
  const bmi = profile.weightKg / (heightMetres * heightMetres);
  const roundedBmi = Math.round(bmi * 10) / 10;
  const bmiScore = Math.round(clamp(100 - Math.abs(bmi - 22) * 5));
  const activityFrequencyScore = (profile.weeklyActivityDays / 7) * 100;
  const activityScore = Math.round((activityFrequencyScore + activityLevelScores[profile.activityLevel]) / 2);
  const goalProgress =
    profile.targetWeightKg === undefined
      ? 50
      : Math.round(
          clamp(
            100 -
              (Math.abs(profile.weightKg - profile.targetWeightKg) /
                Math.max(profile.weightKg, profile.targetWeightKg)) *
                100
          )
        );
  const calculatedHabitsScore = habitsScore(profile);
  const wellnessScore = Math.round(
    bmiScore * 0.3 + activityScore * 0.3 + goalProgress * 0.2 + calculatedHabitsScore * 0.2
  );

  return {
    bmi: roundedBmi,
    bmiClassification: bmiClassification(bmi),
    bmiScore,
    activityScore,
    goalProgress,
    habitsScore: calculatedHabitsScore,
    wellnessScore
  };
}

export function buildProfile(input: unknown): HealthProfile {
  const profile = parseProfile(input);
  return {
    ...profile,
    updatedAt: new Date().toISOString(),
    analytics: calculateAnalytics(profile)
  };
}
