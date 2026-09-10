import { containsPersonalIdentifier, type HealthProfile } from "../profile.js";
import { assertIsoDateTime, assertMealTime, NutritionValidationError } from "./units.js";
import type { MacroTargets, NutritionPreferences } from "./types.js";

export const dietaryPreferenceValues = [
  "vegetarian",
  "vegan",
  "pescatarian",
  "flexitarian",
  "keto",
  "paleo",
  "mediterranean",
  "gluten_free",
  "dairy_free",
  "low_carb",
  "high_protein",
  "low_sodium",
  "halal",
  "kosher",
  "whole_food",
  "low_fat",
  "nut_free",
  "fodmap_friendly",
  "diabetic_friendly",
  "plant_forward"
] as const;

export const allergyValues = [
  "peanuts",
  "tree_nuts",
  "milk",
  "eggs",
  "wheat",
  "soy",
  "fish",
  "shellfish",
  "sesame",
  "mustard",
  "celery",
  "sulfites",
  "lupin",
  "corn",
  "kiwi"
] as const;

const defaultMealTimes = ["08:00", "13:00", "19:00"];
const defaultTimezone = process.env.DEFAULT_TIMEZONE?.trim() || "Europe/Tallinn";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textList(value: unknown, field: string, maximum: number, itemMaximum: number): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > maximum) {
    throw new NutritionValidationError(`${field} must be a list with at most ${maximum} values.`);
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0 || item.trim().length > itemMaximum) {
      throw new NutritionValidationError(`${field} contains an invalid value.`);
    }
    const clean = item.trim();
    if (containsPersonalIdentifier(clean)) {
      throw new NutritionValidationError(`${field} must not include contact details.`);
    }
    if (!result.includes(clean)) {
      result.push(clean);
    }
  }
  return result;
}

function enumList(value: unknown, field: string, allowed: readonly string[]): string[] {
  const result = textList(value, field, 20, 40);
  if (result.some((item) => !allowed.includes(item))) {
    throw new NutritionValidationError(`${field} contains an unsupported value.`);
  }
  return result;
}

function numberValue(value: unknown, field: string, minimum: number, maximum: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new NutritionValidationError(`${field} must be between ${minimum} and ${maximum}.`);
  }
  if (integer && !Number.isInteger(value)) {
    throw new NutritionValidationError(`${field} must be a whole number.`);
  }
  return value;
}

function timezoneValue(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 80) {
    throw new NutritionValidationError("Timezone must be an IANA timezone name.");
  }
  const timezone = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new NutritionValidationError("Timezone must be an IANA timezone name.");
  }
  return timezone;
}

function macroTargets(value: unknown): MacroTargets {
  if (!isRecord(value)) {
    throw new NutritionValidationError("Macro targets must include protein, carbohydrate, and fat values.");
  }
  return {
    proteinG: numberValue(value.proteinG, "proteinG", 0, 1000),
    carbsG: numberValue(value.carbsG, "carbsG", 0, 2000),
    fatsG: numberValue(value.fatsG, "fatsG", 0, 1000)
  };
}

function mealTimes(value: unknown, mealsPerDay: number): string[] {
  const times = value === undefined ? defaultMealTimes.slice(0, mealsPerDay) : textList(value, "mealTimes", 8, 5);
  if (times.length !== mealsPerDay || times.some((time) => {
    try {
      assertMealTime(time);
      return false;
    } catch {
      return true;
    }
  })) {
    throw new NutritionValidationError("Meal times must contain one HH:mm value for each meal.");
  }
  return times;
}

export function parseNutritionPreferences(input: unknown, now = new Date()): NutritionPreferences {
  if (!isRecord(input)) {
    throw new NutritionValidationError("Nutrition preferences must be an object.");
  }
  if (!Number.isFinite(now.getTime())) {
    throw new NutritionValidationError("A valid reference time is required.");
  }
  const mealsPerDay = input.mealsPerDay === undefined ? 3 : numberValue(input.mealsPerDay, "mealsPerDay", 1, 8, true);
  const snacksPerDay = input.snacksPerDay === undefined ? 1 : numberValue(input.snacksPerDay, "snacksPerDay", 0, 5, true);
  const effectiveFrom = input.effectiveFrom === undefined ? now.toISOString() : assertIsoDateTime(input.effectiveFrom);
  return {
    version: 1,
    dietaryPreferences: enumList(input.dietaryPreferences, "dietaryPreferences", dietaryPreferenceValues),
    allergies: enumList(input.allergies, "allergies", allergyValues),
    dislikedIngredients: textList(input.dislikedIngredients, "dislikedIngredients", 20, 60),
    cuisinePreferences: textList(input.cuisinePreferences, "cuisinePreferences", 20, 40),
    calorieTargetKcal: input.calorieTargetKcal === undefined
      ? 2000
      : numberValue(input.calorieTargetKcal, "calorieTargetKcal", 500, 10000),
    macroTargets: input.macroTargets === undefined
      ? { proteinG: 120, carbsG: 250, fatsG: 70 }
      : macroTargets(input.macroTargets),
    mealsPerDay,
    snacksPerDay,
    mealTimes: mealTimes(input.mealTimes, mealsPerDay),
    timezone: timezoneValue(input.timezone === undefined ? defaultTimezone : input.timezone),
    effectiveFrom
  };
}

function normaliseProfileValues(values: string[], allowed: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase().replaceAll("-", "_")).filter((value) => allowed.includes(value)))];
}

function activityMultiplier(profile: HealthProfile): number {
  const multipliers: Record<string, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9
  };
  return multipliers[profile.activityLevel] ?? 1.4;
}

function calorieTarget(profile: HealthProfile): number {
  const fitnessGoal = profile.fitnessGoal as string;
  const genderAdjustment = profile.gender.toLowerCase() === "male" ? 5 : profile.gender.toLowerCase() === "female" ? -161 : -78;
  const resting = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age + genderAdjustment;
  const goal = fitnessGoal === "weight_loss" || fitnessGoal === "fat_loss"
    ? -300
    : fitnessGoal === "muscle_gain"
      ? 250
      : 0;
  return Math.round(Math.min(5000, Math.max(1200, resting * activityMultiplier(profile) + goal)));
}

function macroDefaults(profile: HealthProfile, calories: number): MacroTargets {
  const proteinG = Math.round(profile.weightKg * (profile.fitnessGoal === "muscle_gain" ? 1.8 : 1.6));
  const fatsG = Math.round(profile.weightKg * 0.8);
  const remainingCalories = Math.max(0, calories - proteinG * 4 - fatsG * 9);
  const carbsG = Math.round(remainingCalories / 4);
  return { proteinG, carbsG, fatsG };
}

export function deriveNutritionDefaults(profile: HealthProfile, now = new Date()): NutritionPreferences {
  if (!profile || !Number.isFinite(now.getTime())) {
    throw new NutritionValidationError("A profile and valid reference time are required.");
  }
  const calorieTargetKcal = calorieTarget(profile);
  const input = {
    dietaryPreferences: normaliseProfileValues(profile.dietaryPreferences, dietaryPreferenceValues),
    allergies: normaliseProfileValues(profile.dietaryRestrictions, allergyValues),
    dislikedIngredients: [],
    cuisinePreferences: [],
    calorieTargetKcal,
    macroTargets: macroDefaults(profile, calorieTargetKcal),
    mealsPerDay: 3,
    snacksPerDay: 1,
    mealTimes: defaultMealTimes,
    timezone: defaultTimezone,
    effectiveFrom: now.toISOString()
  };
  return parseNutritionPreferences(input, now);
}
