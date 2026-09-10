import { getPrivacy, getProfile } from "../storage.js";
import { ChatError, isRecord, type ToolResult } from "./types.js";
import { failed, mealTypes, metricNames, resolveDate } from "./data.js";
import { healthGoals, healthMetrics, healthProgress } from "./health-tools.js";
import { mealPlan, nutritionIntake, recipeInformation } from "./nutrition-tools.js";
import { wellnessGuidance } from "./wellness.js";
export { todayForUser } from "./data.js";

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });
const dateSchema = { type: "string", description: "today, tomorrow, yesterday, or YYYY-MM-DD" };
const mealSchema = { type: "string", enum: mealTypes };
const periodSchema = { type: "string", enum: ["today", "week", "month", "last_month"] };
const definition = (name: string, description: string, parameters: Record<string, unknown>) => ({ type: "function" as const, function: { name, description, parameters } });

export const assistantTools = [
  definition("get_health_metrics", "Read own-account weight, BMI, height, wellness components, activity or fitness. An optional date returns exact recorded data for that local date, not current values.", schema({ metrics: { type: "array", minItems: 1, maxItems: 6, uniqueItems: true, items: { type: "string", enum: metricNames } }, date: dateSchema }, ["metrics"])),
  definition("get_health_goals", "Read own saved name, goals, distance to target weight, exercise preferences and current dietary restrictions.", schema({})),
  definition("get_meal_plan", "Read planned meals for one day or seven consecutive days starting on date. Optionally select a meal type. Planned food is not consumed intake.", schema({ date: dateSchema, days: { type: "integer", enum: [1, 7] }, mealType: mealSchema }, ["date"])),
  definition("get_nutrition_intake", "Read own recorded nutrition, target comparison and dietary suggestions. week is trailing seven days; month is trailing thirty days; last_month is the previous calendar month. view=trend describes changes across logged dates. Do not use this for a single planned meal.", schema({ period: periodSchema, view: { type: "string", enum: ["summary", "trend"] } }, ["period"])),
  definition("get_recipe", "Read a planned meal's full ingredients and steps, or its nutrient amounts and daily target comparison. Choose date plus mealType, or a catalogue/own saved recipeId. view=nutrition answers meal-specific nutrient follow-ups. Never use another account's recipe.", schema({ date: dateSchema, mealType: mealSchema, recipeId: { type: "string", minLength: 1, maxLength: 100 }, servings: { type: "number", minimum: 0.125, maximum: 12 }, view: { type: "string", enum: ["recipe", "nutrition"] } })),
  definition("get_health_progress", "Describe recorded weight, health-score or activity trends using calculated differences. week is trailing seven days, month is current calendar month, last_month is previous calendar month.", schema({ metric: { type: "string", enum: ["weight", "bmi", "wellness_score", "activity"] }, period: { type: "string", enum: ["week", "month", "last_month"] } }, ["metric", "period"])),
  definition("get_wellness_guidance", "Give general, non-diagnostic guidance about sleep, activity, gentle stretching, hydration or stress. Medical symptoms still need professional attention.", schema({ topic: { type: "string", enum: ["sleep", "activity", "stretching", "hydration", "stress"] } }, ["topic"])),
];

const properties: Record<string, string[]> = {
  get_health_metrics: ["metrics", "date"], get_health_goals: [], get_meal_plan: ["date", "days", "mealType"],
  get_nutrition_intake: ["period", "view"], get_recipe: ["date", "mealType", "recipeId", "servings", "view"],
  get_health_progress: ["metric", "period"], get_wellness_guidance: ["topic"],
};

function invalidArguments(name: string, args: Record<string, unknown>): string | null {
  if (!Object.hasOwn(properties, name) || Object.keys(args).some((key) => !properties[name].includes(key))) return "This function or parameter is not supported.";
  if (args.date !== undefined && (typeof args.date !== "string" || !resolveDate(args.date, "2000-01-01") || /^\d{4}/u.test(args.date) && (args.date < "1900-01-01" || args.date > "2100-12-31"))) return "Choose today, tomorrow, yesterday or a valid YYYY-MM-DD date between 1900 and 2100.";
  if (args.mealType !== undefined && !mealTypes.includes(args.mealType as typeof mealTypes[number])) return "Choose breakfast, lunch, dinner or snack.";
  if (name === "get_health_metrics" && (!Array.isArray(args.metrics) || args.metrics.length < 1 || args.metrics.length > 6 || args.metrics.some((metric) => !metricNames.includes(metric)) || new Set(args.metrics).size !== args.metrics.length)) return "Choose weight, bmi, wellness_score, activity, height or fitness.";
  if (name === "get_meal_plan" && (typeof args.date !== "string" || args.days !== undefined && args.days !== 1 && args.days !== 7)) return "Choose a date and either one or seven days.";
  if (name === "get_nutrition_intake" && (!["today", "week", "month", "last_month"].includes(args.period as string) || args.view !== undefined && args.view !== "summary" && args.view !== "trend")) return "Choose today, week, month or last_month and summary or trend view.";
  if (name === "get_recipe") {
    if (args.recipeId === undefined && !args.mealType) return "Choose a planned meal type or a recipe identifier.";
    if (args.recipeId !== undefined && (typeof args.recipeId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u.test(args.recipeId))) return "Choose a valid recipe identifier.";
    if (args.recipeId && (args.mealType || args.date)) return "Choose a recipe identifier or a dated meal, not both.";
    if (args.servings !== undefined && (typeof args.servings !== "number" || !Number.isFinite(args.servings) || args.servings < 0.125 || args.servings > 12)) return "Servings must be from 0.125 to 12.";
    if (args.view !== undefined && args.view !== "recipe" && args.view !== "nutrition") return "Choose recipe or nutrition view.";
  }
  if (name === "get_health_progress" && (!["weight", "bmi", "wellness_score", "activity"].includes(args.metric as string) || !["week", "month", "last_month"].includes(args.period as string))) return "Choose a supported health metric and week, month or last_month.";
  if (name === "get_wellness_guidance" && !["sleep", "activity", "stretching", "hydration", "stress"].includes(args.topic as string)) return "Choose sleep, activity, stretching, hydration or stress.";
  return null;
}

export function executeAssistantTool(userId: number, name: string, args: unknown, now = new Date()): ToolResult {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new ChatError(401, "Sign in to chat with Hale.");
  if (!isRecord(args)) return failed("invalid_arguments", "Function arguments must be an object.");
  const invalid = invalidArguments(name, args);
  if (invalid) return failed("invalid_arguments", invalid);
  try {
    const profile = getProfile(userId);
    if (!profile || !getPrivacy(userId)?.consentGiven) return failed("not_found", "Complete your health profile before asking about saved data.");
    if (name === "get_health_metrics") return healthMetrics(userId, profile, args, now);
    if (name === "get_health_goals") return healthGoals(userId, profile);
    if (name === "get_health_progress") return healthProgress(userId, profile, args, now);
    if (name === "get_meal_plan") return mealPlan(userId, args, now);
    if (name === "get_nutrition_intake") return nutritionIntake(userId, profile, args, now);
    if (name === "get_recipe") return recipeInformation(userId, profile, args, now);
    return wellnessGuidance(profile, args.topic as "sleep" | "activity" | "stretching" | "hydration" | "stress");
  } catch {
    return failed("unavailable", "The saved data could not be read. Try again in a moment.");
  }
}
