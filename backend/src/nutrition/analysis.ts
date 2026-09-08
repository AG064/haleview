import type { HealthProfile } from "../profile.js";
import type { NutritionProvider } from "./provider.js";
import type { NutritionIntakeRecord } from "./intake.js";
import { searchRecipes } from "./catalog.js";
import { restrictiveDietaryTags, dietaryStylePreferences } from "./dietary-policy.js";
import { micronutrientReferences, type MicronutrientKey } from "./micronutrients.js";
import type { NutritionPreferences, NutritionValues } from "./types.js";

export type CalorieStatus = "deficit" | "on_target" | "surplus";

export interface NutritionTargetValues {
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
}

export interface PeriodNutrition {
  days: number;
  recordCount: number;
  nutrition: NutritionValues;
  dailyAverage: NutritionValues;
  targets: NutritionTargetValues;
  calorieBalanceKcal: number;
  calorieStatus: CalorieStatus;
  macroPercentages: { protein: number; carbs: number; fats: number };
}

export interface NutritionTrendPoint {
  date: string;
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
  calorieTargetKcal: number;
}

export interface NutritionSummary {
  source: "local" | "deepseek";
  model: string | null;
  text: string;
  suggestions: string[];
}

export interface NutritionProgress {
  generatedAt: string;
  targets: NutritionTargetValues;
  today: PeriodNutrition;
  week: PeriodNutrition;
  month: PeriodNutrition;
  trend: NutritionTrendPoint[];
  nutritionScore: number;
  wellnessScore: number;
  baseWellnessScore: number;
  micronutrients: Pick<NutritionValues, "fiberG" | "sodiumMg" | "vitaminDMcg" | "vitaminB12Mcg" | "ironMg" | "calciumMg" | "magnesiumMg">;
  micronutrientGuidance: MicronutrientGuidance[];
  summary: NutritionSummary;
}

export interface MicronutrientGuidance {
  key: MicronutrientKey;
  label: string;
  current: number;
  target: number;
  unit: "g" | "mg" | "mcg";
  kind: "minimum" | "maximum";
  percent: number;
  status: "low" | "within_reference" | "high";
  guidance: string;
  recipes: Array<{ id: string; title: string }>;
}

export interface NutritionProgressInput {
  profile: HealthProfile;
  preferences: NutritionPreferences;
  records: NutritionIntakeRecord[];
  now?: () => Date;
}

export interface NutritionSummaryOptions {
  provider?: NutritionProvider | null;
}

const nutritionKeys: Array<keyof NutritionValues> = [
  "caloriesKcal", "proteinG", "carbsG", "fatsG", "fiberG", "sugarG", "sodiumMg",
  "vitaminDMcg", "vitaminB12Mcg", "ironMg", "calciumMg", "magnesiumMg",
];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function emptyNutrition(): NutritionValues {
  return {
    caloriesKcal: 0, proteinG: 0, carbsG: 0, fatsG: 0, fiberG: 0, sugarG: 0,
    sodiumMg: 0, vitaminDMcg: 0, vitaminB12Mcg: 0, ironMg: 0, calciumMg: 0, magnesiumMg: 0,
  };
}

function addNutrition(total: NutritionValues, value: NutritionValues): void {
  for (const key of nutritionKeys) total[key] = round(total[key] + value[key]);
}

function dateInTimezone(value: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    return value.toISOString().slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

function shiftDate(value: string, offset: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function targetValues(preferences: NutritionPreferences, days = 1): NutritionTargetValues {
  return {
    caloriesKcal: round(preferences.calorieTargetKcal * days),
    proteinG: round(preferences.macroTargets.proteinG * days),
    carbsG: round(preferences.macroTargets.carbsG * days),
    fatsG: round(preferences.macroTargets.fatsG * days),
  };
}

function percentage(actual: number, target: number): number {
  return target <= 0 ? 0 : Math.round(actual / target * 100);
}

function calorieStatus(actual: number, target: number): CalorieStatus {
  const tolerance = target * 0.05;
  if (actual < target - tolerance) return "deficit";
  if (actual > target + tolerance) return "surplus";
  return "on_target";
}

function buildPeriod(records: NutritionIntakeRecord[], endDate: string, days: number, preferences: NutritionPreferences): PeriodNutrition {
  const startDate = shiftDate(endDate, -(days - 1));
  const selected = records.filter((record) => record.date >= startDate && record.date <= endDate);
  const nutrition = emptyNutrition();
  selected.forEach((record) => addNutrition(nutrition, record.nutrition));
  const dailyAverage = emptyNutrition();
  nutritionKeys.forEach((key) => { dailyAverage[key] = round(nutrition[key] / days); });
  const targets = targetValues(preferences, days);
  return {
    days,
    recordCount: selected.length,
    nutrition,
    dailyAverage,
    targets,
    calorieBalanceKcal: round(nutrition.caloriesKcal - targets.caloriesKcal),
    calorieStatus: calorieStatus(nutrition.caloriesKcal, targets.caloriesKcal),
    macroPercentages: {
      protein: percentage(nutrition.proteinG, targets.proteinG),
      carbs: percentage(nutrition.carbsG, targets.carbsG),
      fats: percentage(nutrition.fatsG, targets.fatsG),
    },
  };
}

function closeness(actual: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round(clamp(100 - Math.abs(actual - target) / target * 100));
}

function scoreForToday(today: PeriodNutrition): number {
  const calorie = closeness(today.nutrition.caloriesKcal, today.targets.caloriesKcal);
  const protein = closeness(today.nutrition.proteinG, today.targets.proteinG);
  const carbs = closeness(today.nutrition.carbsG, today.targets.carbsG);
  const fats = closeness(today.nutrition.fatsG, today.targets.fatsG);
  return Math.round(calorie * 0.4 + protein * 0.2 + carbs * 0.2 + fats * 0.2);
}

function localSummary(
  today: PeriodNutrition,
  profile: HealthProfile,
  week: PeriodNutrition,
  trend: NutritionTrendPoint[],
): NutritionSummary {
  let text = "No nutrition intake is recorded for today.";
  if (today.recordCount > 0 && today.calorieStatus === "deficit") {
    text = `${Math.abs(Math.round(today.calorieBalanceKcal))} kcal is below the daily target.`;
  } else if (today.recordCount > 0 && today.calorieStatus === "surplus") {
    text = `${Math.abs(Math.round(today.calorieBalanceKcal))} kcal is above the daily target.`;
  } else if (today.recordCount > 0) {
    text = "Today is close to the saved calorie target.";
  }

  if (today.recordCount > 0) {
    const lowestMacro = [
      { label: "protein", value: today.macroPercentages.protein },
      { label: "carbohydrate", value: today.macroPercentages.carbs },
      { label: "fat", value: today.macroPercentages.fats },
    ].sort((left, right) => left.value - right.value)[0];
    text += ` ${lowestMacro.label[0].toUpperCase()}${lowestMacro.label.slice(1)} is at ${lowestMacro.value}% of the daily target.`;
  }

  const recentRecordedDays = trend.slice(-7).filter((point) => point.caloriesKcal > 0);
  const daysNearTarget = recentRecordedDays.filter((point) => Math.abs(point.caloriesKcal - point.calorieTargetKcal) <= point.calorieTargetKcal * 0.1).length;
  const largeDeficitDays = recentRecordedDays.filter((point) => point.calorieTargetKcal - point.caloriesKcal > 500).length;
  if (daysNearTarget >= 3) {
    text += ` Achievement: ${daysNearTarget} recorded day(s) were within 10% of the calorie target this week.`;
  }
  if (largeDeficitDays >= 2) {
    text += ` Concern: ${largeDeficitDays} recorded day(s) were more than 500 kcal below target.`;
  } else if (week.recordCount > 0 && week.macroPercentages.protein < 70) {
    text += " Concern: weekly protein is below 70% of the saved target.";
  }

  const suggestions: string[] = [];
  if (today.recordCount === 0) {
    suggestions.push("Record a meal to start the daily comparison.");
  } else {
    if (profile.fitnessGoal === "weight_loss" && today.calorieStatus === "surplus") {
      suggestions.push("Use a smaller portion at the next meal to return toward the saved weight goal target.");
    } else if (today.calorieStatus === "deficit") {
      suggestions.push("Increase the next portion if the daily gap becomes larger than planned.");
    } else {
      suggestions.push("Keep the next portion close to the saved plan amount.");
    }
    if (today.macroPercentages.protein < 90) {
      suggestions.push("Choose a protein source that fits the saved restrictions.");
    } else if (today.nutrition.fiberG < 20) {
      suggestions.push("Add a fibre-rich food that fits the saved restrictions.");
    }
    suggestions.push("Keep the next meal near the saved meal time.");
    suggestions.push("Review the weekly plan and use a suitable ingredient alternative where the macro balance is weakest.");
  }
  return { source: "local", model: null, text, suggestions: suggestions.slice(0, 4) };
}

function restrictedTerms(profile: HealthProfile, preferences: NutritionPreferences): string[] {
  return [...new Set([
    ...profile.dietaryRestrictions,
    ...preferences.allergies,
    ...preferences.dislikedIngredients,
  ].map((value) => value.trim().toLowerCase().replaceAll("_", " ")).filter(Boolean))];
}

function suggestionDietaryTags(preferences: NutritionPreferences): string[] {
  return restrictiveDietaryTags(preferences.dietaryPreferences);
}

function buildMicronutrientGuidance(nutrition: NutritionValues, preferences: NutritionPreferences): MicronutrientGuidance[] {
  const safeRecipes = searchRecipes({
    query: [...preferences.cuisinePreferences, ...dietaryStylePreferences(preferences.dietaryPreferences)].join(" ").slice(0, 160),
    dietaryTags: suggestionDietaryTags(preferences),
    allergies: preferences.allergies,
    excludedIngredients: preferences.dislikedIngredients,
    limit: 50,
  });
  return micronutrientReferences.map((reference) => {
    const current = nutrition[reference.key];
    const percent = reference.target > 0 ? Math.round(current / reference.target * 100) : 0;
    const status = reference.kind === "maximum"
      ? (current > reference.target ? "high" as const : "within_reference" as const)
      : (current < reference.target * 0.75 ? "low" as const : "within_reference" as const);
    const ranked = [...safeRecipes].sort((left, right) => reference.kind === "maximum"
      ? left.nutrition[reference.key] - right.nutrition[reference.key]
      : right.nutrition[reference.key] - left.nutrition[reference.key]);
    const recipes = status === "within_reference" ? [] : ranked.slice(0, 2).map((item) => ({
      id: item.recipe.id,
      title: item.recipe.title,
    }));
    const guidance = status === "low"
      ? `Intake is below the general daily reference. Review recipes with more ${reference.label.toLowerCase()}.`
      : status === "high"
        ? `Intake is above the general daily limit. Review lower-${reference.label.toLowerCase()} recipes.`
        : `Intake is within the general daily reference for ${reference.label.toLowerCase()}.`;
    return { ...reference, current, percent, status, guidance, recipes };
  });
}

export function buildNutritionProgress(input: NutritionProgressInput): NutritionProgress {
  const now = input.now?.() ?? new Date();
  const currentDate = dateInTimezone(now, input.preferences.timezone);
  const today = buildPeriod(input.records, currentDate, 1, input.preferences);
  const week = buildPeriod(input.records, currentDate, 7, input.preferences);
  const month = buildPeriod(input.records, currentDate, 30, input.preferences);
  const nutritionScore = scoreForToday(today);
  const baseWellnessScore = input.profile.analytics.wellnessScore;
  const wellnessScore = today.recordCount > 0
    ? Math.round(baseWellnessScore * 0.75 + nutritionScore * 0.25)
    : baseWellnessScore;
  const trend = Array.from({ length: 30 }, (_, index) => {
    const date = shiftDate(currentDate, index - 29);
    const nutrition = emptyNutrition();
    input.records.filter((record) => record.date === date).forEach((record) => addNutrition(nutrition, record.nutrition));
    return {
      date,
      caloriesKcal: nutrition.caloriesKcal,
      proteinG: nutrition.proteinG,
      carbsG: nutrition.carbsG,
      fatsG: nutrition.fatsG,
      calorieTargetKcal: input.preferences.calorieTargetKcal,
    };
  });
  return {
    generatedAt: now.toISOString(),
    targets: targetValues(input.preferences),
    today,
    week,
    month,
    trend,
    nutritionScore,
    wellnessScore,
    baseWellnessScore,
    micronutrients: {
      fiberG: today.nutrition.fiberG,
      sodiumMg: today.nutrition.sodiumMg,
      vitaminDMcg: today.nutrition.vitaminDMcg,
      vitaminB12Mcg: today.nutrition.vitaminB12Mcg,
      ironMg: today.nutrition.ironMg,
      calciumMg: today.nutrition.calciumMg,
      magnesiumMg: today.nutrition.magnesiumMg,
    },
    micronutrientGuidance: buildMicronutrientGuidance(today.nutrition, input.preferences),
    summary: localSummary(today, input.profile, week, trend),
  };
}

export async function buildNutritionSummary(
  progress: NutritionProgress,
  profile: HealthProfile,
  preferences: NutritionPreferences,
  options: NutritionSummaryOptions = {},
): Promise<NutritionSummary> {
  const provider = options.provider;
  if (!provider || progress.today.recordCount === 0) return progress.summary;
  const allowedSuggestions = progress.summary.suggestions.map((text, index) => ({ id: `suggestion-${index + 1}`, text }));
  try {
    const completion = await provider.complete({
      name: "nutrition_review",
      previousStep: "recipe_generation",
      settings: { temperature: 0.2, topP: 1, maxTokens: 500 },
      messages: [
        {
          role: "system",
          content: "Review the supplied achievements, concerns, macro balance and saved targets. Return one JSON object with suggestionIds, a list of one to four unique IDs from allowedSuggestions in priority order. The application will combine your choices with its calculated summary. Do not invent advice, rewrite numerical facts, diagnose, or add other fields. Example: {\"suggestionIds\":[\"suggestion-1\"]}.",
        },
        {
          role: "user",
          content: JSON.stringify({
            goal: profile.fitnessGoal,
            restrictions: restrictedTerms(profile, preferences),
            dietaryPreferences: preferences.dietaryPreferences,
            today: progress.today,
            week: progress.week,
            nutritionScore: progress.nutritionScore,
            calculatedSummary: progress.summary.text,
            allowedSuggestions,
          }),
        },
      ],
    });
    const ids = completion.content.suggestionIds;
    if (completion.toolCalls.length > 0 || !Array.isArray(ids) || ids.length < 1 || ids.length > 4 || new Set(ids).size !== ids.length) return progress.summary;
    const suggestions: string[] = [];
    for (const id of ids) {
      const match = allowedSuggestions.find((suggestion) => suggestion.id === id);
      if (!match) return progress.summary;
      suggestions.push(match.text);
    }
    return { source: "deepseek", model: completion.model, text: progress.summary.text, suggestions };
  } catch {
    return progress.summary;
  }
}
