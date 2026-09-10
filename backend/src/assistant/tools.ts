import { getPrivacy, getProfile } from "../storage.js";
import { defaultTimezone } from "../timezone.js";
import { containsPersonalIdentifier } from "../profile.js";
import { buildNutritionProgress } from "../nutrition/analysis.js";
import { listIntakeRecords } from "../nutrition/intake.js";
import { listMealPlans } from "../nutrition/meal-plan-storage.js";
import { deriveNutritionDefaults } from "../nutrition/preferences.js";
import { getNutritionPreferences } from "../nutrition/storage.js";
import { ChatError, isRecord, type ToolResult } from "./types.js";
import { hasPrivateText } from "./privacy.js";

const metricNames = ["weight", "bmi", "wellness_score", "activity"] as const;
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object", additionalProperties: false, properties, required,
});

export const assistantTools = [
  {
    type: "function",
    function: {
      name: "get_health_metrics",
      description: "Read the signed-in user's current saved health metrics. Does not provide historical trends.",
      parameters: schema({ metrics: { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: { type: "string", enum: metricNames } } }, ["metrics"]),
    },
  },
  {
    type: "function",
    function: {
      name: "get_health_goals",
      description: "Read the signed-in user's saved fitness goal, target weight, exercise and dietary preferences.",
      parameters: schema({}),
    },
  },
  {
    type: "function",
    function: {
      name: "get_meal_plan",
      description: "Read meals for one date from the signed-in user's most recently saved matching plan. Planned food is not consumed intake.",
      parameters: schema({ date: { type: "string", description: "today, tomorrow, or YYYY-MM-DD" } }, ["date"]),
    },
  },
  {
    type: "function",
    function: {
      name: "get_nutrition_intake",
      description: "Read actual recorded calories and macros versus saved targets for today or the last seven days. Missing records do not prove the user ate nothing.",
      parameters: schema({ period: { type: "string", enum: ["today", "week"] } }, ["period"]),
    },
  },
] as const;

function failed(code: ToolResult["code"], message: string): ToolResult {
  return { ok: false, code, section: { title: "Data unavailable", lines: [message] } };
}

function number(value: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1, useGrouping: false }).format(value);
}

function safePreference(value: string): string {
  return containsPersonalIdentifier(value) || hasPrivateText(value) ? "Not shared with chat" : value.replaceAll("_", " ");
}

export function todayForUser(userId: number, now: Date): string {
  const timezone = getNutritionPreferences(userId)?.timezone ?? defaultTimezone();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function resolveDate(value: string, today: string): string | null {
  if (value === "today") return today;
  if (value === "tomorrow") {
    const next = new Date(`${today}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function executeAssistantTool(userId: number, name: string, args: unknown, now = new Date()): ToolResult {
  // Account identity comes only from the authenticated route, never from tool arguments.
  if (!Number.isSafeInteger(userId) || userId < 1) throw new ChatError(401, "Sign in to chat with Hale.");
  if (!isRecord(args)) return failed("invalid_arguments", "Function arguments must be an object.");
  const allowed = name === "get_health_metrics" ? ["metrics"] : name === "get_health_goals" ? []
    : name === "get_meal_plan" ? ["date"] : name === "get_nutrition_intake" ? ["period"] : null;
  if (!allowed || Object.keys(args).some((key) => !allowed.includes(key))) {
    return failed("invalid_arguments", "This function or parameter is not supported.");
  }
  if (name === "get_health_metrics" && (!Array.isArray(args.metrics) || args.metrics.length < 1 || args.metrics.length > 4
    || args.metrics.some((metric) => !metricNames.includes(metric)) || new Set(args.metrics).size !== args.metrics.length)) {
    return failed("invalid_arguments", "Choose weight, bmi, wellness_score or activity.");
  }
  if (name === "get_meal_plan" && (typeof args.date !== "string" || !resolveDate(args.date, "2000-01-01"))) {
    return failed("invalid_arguments", "Choose today, tomorrow or a valid YYYY-MM-DD date.");
  }
  if (name === "get_nutrition_intake" && args.period !== "today" && args.period !== "week") {
    return failed("invalid_arguments", "Choose today or week.");
  }
  const profile = getProfile(userId);
  if (!profile || !getPrivacy(userId)?.consentGiven) return failed("not_found", "Complete your health profile before asking about saved data.");
  try {
    const section = { title: "", lines: [] as string[] };
    if (name === "get_health_metrics") {
      section.title = "Current health metrics";
      const metrics = args.metrics as string[];
      if (metrics.includes("weight")) section.lines.push(`Weight: ${number(profile.weightKg)} kg`);
      if (metrics.includes("bmi")) section.lines.push(`BMI: ${number(profile.analytics.bmi)}`);
      if (metrics.includes("wellness_score")) {
        const preferences = getNutritionPreferences(userId) ?? deriveNutritionDefaults(profile);
        const progress = buildNutritionProgress({ profile, preferences, records: listIntakeRecords(userId, { limit: 1000 }), now: () => now });
        section.lines.push(`Wellness score: ${number(progress.wellnessScore)} / 100`);
      }
      if (metrics.includes("activity")) section.lines.push(`Activity level: ${profile.activityLevel.replaceAll("_", " ")}`, `Weekly activity goal: ${profile.weeklyActivityDays} days`);
    } else if (name === "get_health_goals") {
      section.title = "Your saved goals";
      section.lines.push(`Fitness goal: ${profile.fitnessGoal.replaceAll("_", " ")}`);
      if (profile.targetWeightKg !== undefined) section.lines.push(`Target weight: ${number(profile.targetWeightKg)} kg`);
      section.lines.push(`Activity goal: ${profile.weeklyActivityDays} days per week`, `Exercise preferences: ${profile.exerciseTypes.join(", ")}`);
      if (profile.dietaryPreferences.length) section.lines.push(`Diet: ${profile.dietaryPreferences.map(safePreference).join(", ")}`);
      if (profile.dietaryRestrictions.length) section.lines.push(`Restrictions: ${profile.dietaryRestrictions.map(safePreference).join(", ")}`);
    } else if (name === "get_meal_plan") {
      const date = resolveDate(args.date as string, todayForUser(userId, now))!;
      const plans = listMealPlans(userId, 50).sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
      const plan = plans.find((item) => item.days.some((day) => day.date === date));
      const day = plan?.days.find((item) => item.date === date);
      if (!day?.meals.length) return failed("not_found", `No meals were found in your recent saved plans for ${date}. Open Meal plan to create or review a plan.`);
      section.title = `Meal plan for ${date}`;
      section.lines = day.meals.map((meal) => `${meal.mealType} at ${meal.time}: ${safePreference(meal.title)} (${number(meal.nutrition.caloriesKcal)} kcal)`);
      section.lines.push("These are planned meals, not recorded intake.");
    } else {
      const preferences = getNutritionPreferences(userId) ?? deriveNutritionDefaults(profile);
      const progress = buildNutritionProgress({ profile, preferences, records: listIntakeRecords(userId, { limit: 1000 }), now: () => now });
      const period = args.period === "week" ? progress.week : progress.today;
      if (period.recordCount === 0) return failed("not_found", `No intake was recorded for ${args.period === "week" ? "the last seven days" : "today"}. Record eaten meals in Nutrition to compare them with your targets.`);
      section.title = args.period === "week" ? "Recorded intake over the last seven days" : "Today's recorded intake";
      section.lines.push(
        `Energy: ${number(period.nutrition.caloriesKcal)} / ${number(period.targets.caloriesKcal)} kcal`,
        `Protein: ${number(period.nutrition.proteinG)} / ${number(period.targets.proteinG)} g`,
        `Carbohydrates: ${number(period.nutrition.carbsG)} / ${number(period.targets.carbsG)} g`,
        `Fat: ${number(period.nutrition.fatsG)} / ${number(period.targets.fatsG)} g`,
        "Only recorded food is counted; unlogged meals are unknown.",
      );
    }
    return { ok: true, section };
  } catch {
    return failed("unavailable", "The saved data could not be read. Try again in a moment.");
  }
}
