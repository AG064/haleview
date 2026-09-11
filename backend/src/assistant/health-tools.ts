import { getHistory, type HealthHistory } from "../storage.js";
import type { HealthProfile } from "../profile.js";
import { deriveNutritionDefaults } from "../nutrition/preferences.js";
import { getNutritionPreferences } from "../nutrition/storage.js";
import { buildNutritionProgress } from "../nutrition/analysis.js";
import { listIntakeRecords } from "../nutrition/intake.js";
import { dateInZone, failed, formatNumber as number, periodRange, resolveDate, safeDataText, timezoneForUser, todayForUser } from "./data.js";
import type { ChatReference, ChatSection, ToolResult } from "./types.js";

function nutritionProgress(userId: number, profile: HealthProfile, now: Date) {
  const preferences = getNutritionPreferences(userId) ?? deriveNutritionDefaults(profile);
  return buildNutritionProgress({ profile, preferences, records: listIntakeRecords(userId, { limit: 1000 }), now: () => now });
}

function weakestComponent(profile: HealthProfile): { label: string; score: number; action: string } {
  const items = [
    { label: "Activity", score: profile.analytics.activityScore, action: `Start with an activity you enjoy and build toward your saved goal of ${profile.weeklyActivityDays} active days per week.` },
    { label: "Habits", score: profile.analytics.habitsScore, action: `Use your preferred ${profile.exerciseTypes.join(" or ") || "activity"} routine consistently and record what you complete.` },
    { label: "Goal progress", score: profile.analytics.goalProgress, action: "Review your target and recent records before changing the plan. Gradual, sustainable progress matters." },
    { label: "BMI component", score: profile.analytics.bmiScore, action: "Review weight trends alongside your goals and activity. BMI alone does not describe overall health." },
  ];
  return items.sort((first, second) => first.score - second.score)[0];
}

export function healthMetrics(userId: number, profile: HealthProfile, args: Record<string, unknown>, now: Date): ToolResult {
  const metrics = args.metrics as string[];
  const section: ChatSection = { title: "Current health metrics", lines: [], details: [], kind: "metrics" };
  if (args.date && args.date !== "today") return historicalMetrics(userId, metrics, args.date as string, now);
  if (metrics.includes("weight")) section.lines.push(`Weight: ${number(profile.weightKg)} kg`);
  if (metrics.includes("bmi")) {
    section.lines.push(`BMI: ${number(profile.analytics.bmi)}`);
    section.details!.push("BMI compares weight with height. It is a screening measure, not a diagnosis or a complete assessment of health.");
  }
  if (metrics.includes("height")) section.lines.push(`Height: ${number(profile.heightCm)} cm`);
  if (metrics.includes("wellness_score")) {
    const progress = nutritionProgress(userId, profile, now);
    const weakest = weakestComponent(profile);
    section.lines.push(`Wellness score: ${number(progress.wellnessScore)} / 100`, `Lowest health component: ${weakest.label.toLowerCase()} (${number(weakest.score)} / 100)`, weakest.action);
    if (progress.today.recordCount > 0 && progress.nutritionScore < weakest.score) section.lines.push(`Today's recorded nutrition score is lower still: ${number(progress.nutritionScore)} / 100. Check that all eaten meals are logged before drawing conclusions.`);
    section.details!.push(`Health-only score: ${number(profile.analytics.wellnessScore)} / 100`, `BMI component: ${number(profile.analytics.bmiScore)} / 100`, `Activity component: ${number(profile.analytics.activityScore)} / 100`, `Habits component: ${number(profile.analytics.habitsScore)} / 100`, "The wellness score is an application score. Missing intake records can change its interpretation.");
  }
  if (metrics.includes("activity")) section.lines.push(`Activity level: ${profile.activityLevel.replaceAll("_", " ")}`, `Weekly activity goal: ${profile.weeklyActivityDays} days`);
  if (metrics.includes("fitness")) section.lines.push(`Fitness level: ${profile.fitnessLevel}`, `Endurance: ${number(profile.enduranceMinutes)} minutes`, `Push-ups: ${number(profile.pushups)}`, `Squats: ${number(profile.squats)}`);
  section.details!.push(`Profile last saved: ${dateInZone(new Date(profile.updatedAt), timezoneForUser(userId))}`);
  return { ok: true, section, reference: { topic: "health", metrics: metrics as ChatReference["metrics"] } };
}

function recordsOnDate<T extends { recordedAt: string }>(records: T[], date: string, timezone: string): T[] {
  return records.filter((item) => dateInZone(new Date(item.recordedAt), timezone) === date).sort((first, second) => second.recordedAt.localeCompare(first.recordedAt));
}

function historicalMetrics(userId: number, metrics: string[], dateValue: string, now: Date): ToolResult {
  const date = resolveDate(dateValue, todayForUser(userId, now))!;
  const history = getHistory(userId);
  const timezone = timezoneForUser(userId);
  const weight = recordsOnDate(history.weights, date, timezone)[0];
  const analytics = recordsOnDate(history.analytics, date, timezone)[0];
  const activity = recordsOnDate(history.activities, date, timezone)[0];
  const values: Record<string, string | undefined> = {
    weight: weight ? `Weight: ${number(weight.weightKg)} kg` : undefined,
    bmi: analytics ? `BMI: ${number(analytics.bmi)}` : undefined,
    wellness_score: analytics ? `Recorded health score: ${number(analytics.wellnessScore)} / 100` : undefined,
    activity: activity ? `Recorded active-day value: ${number(activity.activeDays)}` : undefined,
  };
  if (!metrics.some((metric) => values[metric])) return failed("not_found", `No requested health metrics were recorded on ${date}.`);
  return { ok: true, section: { title: `Health records for ${date}`, kind: "metrics", lines: metrics.map((metric) => values[metric] ?? `No ${metric.replaceAll("_", " ")} was recorded for this date.`), details: ["Historical health scores use the saved health assessment; they do not reconstruct later nutrition adjustments."] }, reference: { topic: "health", date, metrics: metrics as ChatReference["metrics"] } };
}

export function healthGoals(userId: number, profile: HealthProfile): ToolResult {
  const preferences = getNutritionPreferences(userId) ?? deriveNutritionDefaults(profile);
  const section: ChatSection = { title: "Your saved goals", kind: "progress", lines: [], details: [] };
  if (profile.displayName) section.lines.push(`Name: ${safeDataText(profile.displayName)}`);
  section.lines.push(`Fitness goal: ${profile.fitnessGoal.replaceAll("_", " ")}`);
  if (profile.targetWeightKg !== undefined) {
    const difference = profile.weightKg - profile.targetWeightKg;
    section.lines.push(`Target weight: ${number(profile.targetWeightKg)} kg`, `Distance to target: ${number(Math.abs(difference))} kg`, Math.abs(difference) < 0.1 ? "Your saved weight matches the target." : `Your saved weight is ${difference > 0 ? "above" : "below"} the target.`);
  } else section.lines.push("No target weight is saved. You can add one in Profile if it fits your goal.");
  section.lines.push(`Activity goal: ${profile.weeklyActivityDays} days per week`, `Exercise preferences: ${profile.exerciseTypes.join(", ") || "Not specified"}`);
  if (preferences.dietaryPreferences.length) section.lines.push(`Diet: ${preferences.dietaryPreferences.map(safeDataText).join(", ")}`);
  const restrictions = [...new Set([...profile.dietaryRestrictions, ...preferences.allergies])];
  if (restrictions.length) section.lines.push(`Restrictions: ${restrictions.map(safeDataText).join(", ")}`);
  section.details!.push(`Daily energy target: ${number(preferences.calorieTargetKcal)} kcal`, `Daily protein target: ${number(preferences.macroTargets.proteinG)} g`, `Exercise setting: ${profile.exerciseEnvironment}; preferred time: ${profile.exerciseTime}`);
  if (preferences.dislikedIngredients.length) section.details!.push(`Avoided ingredients: ${preferences.dislikedIngredients.map(safeDataText).join(", ")}`);
  return { ok: true, section, reference: { topic: "goals" } };
}

function trendDescription(values: number[], metric: string): string {
  if (values.length < 2) return "Only one measurement is available, so a trend cannot be determined.";
  const difference = values.at(-1)! - values[0];
  const tolerance = metric === "weight" ? 0.2 : metric === "bmi" ? 0.1 : 1;
  const spread = Math.max(...values) - Math.min(...values);
  if (Math.abs(difference) < tolerance) return spread < tolerance ? "The recorded values were stable over this period." : "The period ended close to where it started, with changes between the recordings.";
  const steps = values.slice(1).map((value, index) => value - values[index]);
  const sameDirection = steps.every((step) => difference < 0 ? step <= 0 : step >= 0);
  return `The recorded ${metric === "weight" ? "weight" : metric === "bmi" ? "BMI" : "health score"} ${difference < 0 ? "decreased" : "increased"} ${sameDirection && values.length >= 3 ? "consistently across the available measurements" : "between the first and last measurements"}.`;
}

export function healthProgress(userId: number, profile: HealthProfile, args: Record<string, unknown>, now: Date): ToolResult {
  const period = (args.period ?? "month") as ChatReference["period"];
  const metric = (args.metric ?? "weight") as NonNullable<ChatReference["metric"]>;
  const range = periodRange(todayForUser(userId, now), period!);
  const history: HealthHistory = getHistory(userId);
  const timezone = timezoneForUser(userId);
  const points = (metric === "weight" ? history.weights.map((item) => ({ date: item.recordedAt, value: item.weightKg }))
    : metric === "wellness_score" || metric === "bmi" ? history.analytics.map((item) => ({ date: item.recordedAt, value: metric === "bmi" ? item.bmi : item.wellnessScore }))
      : history.activities.map((item) => ({ date: item.recordedAt, value: item.activeDays })))
    .map((item) => ({ ...item, localDate: dateInZone(new Date(item.date), timezone) }))
    .filter((item) => item.localDate >= range.from && item.localDate <= range.to)
    .sort((first, second) => first.date.localeCompare(second.date));
  if (!points.length) return failed("not_found", `No ${metric.replaceAll("_", " ")} records are available from ${range.from} to ${range.to}.`);
  const section: ChatSection = { title: `${metric === "weight" ? "Weight" : metric === "bmi" ? "BMI" : metric === "activity" ? "Activity" : "Health score"} progress`, kind: "progress", lines: [`Period: ${range.from} to ${range.to}`], details: [] };
  if (metric === "activity") {
    section.lines.push(`Activity records: ${points.length}`, `Total of recorded active-day values: ${number(points.reduce((sum, point) => sum + point.value, 0))}`, `Weekly activity goal: ${profile.weeklyActivityDays} days`, `Current self-reported fitness level: ${profile.fitnessLevel}`);
    section.details!.push("Activity records show what was logged. They do not establish unique exercise dates or prove a change in fitness level.");
  } else {
    const first = points[0];
    const last = points.at(-1)!;
    const unit = metric === "weight" ? " kg" : metric === "bmi" ? "" : " points";
    section.lines.push(`First: ${number(first.value)}${unit} on ${first.localDate}`, `Latest: ${number(last.value)}${unit} on ${last.localDate}`);
    if (points.length > 1) {
      const delta = last.value - first.value;
      section.lines.push(`Change: ${delta > 0 ? "+" : ""}${number(delta)}${unit}`);
    }
    section.lines.push(trendDescription(points.map((point) => point.value), metric));
    if (metric === "weight" && profile.targetWeightKg !== undefined) section.lines.push(`Saved target: ${number(profile.targetWeightKg)} kg; latest recorded distance: ${number(Math.abs(last.value - profile.targetWeightKg))} kg`);
    if (metric === "wellness_score") section.details!.push("These are saved health scores, without reconstructed nutrition adjustments.");
  }
  section.details!.push(`Available measurements: ${points.length}`, ...points.slice(-12).map((point) => `${point.localDate}: ${number(point.value)}${metric === "weight" ? " kg" : metric === "wellness_score" ? " points" : metric === "bmi" ? "" : " active-day value"}`), "Missing dates are not interpolated. These observations do not explain the cause of a change.");
  if (args.visualization === "line") {
    const unit = metric === "weight" ? "kg" : metric === "wellness_score" ? "points" : metric === "activity" ? "active-day value" : "BMI";
    const dailyPoints = [...new Map(points.map((point) => [point.localDate, point])).values()];
    section.chart = {
      type: "line",
      title: `${metric === "weight" ? "Weight" : metric === "bmi" ? "BMI" : metric === "activity" ? "Activity" : "Health score"} over time`,
      unit,
      description: `Latest recorded ${metric.replaceAll("_", " ")} for each local date from ${range.from} to ${range.to}. Missing dates are not interpolated.`,
      items: dailyPoints.slice(-31).map((point) => ({ label: point.localDate, value: point.value })),
    };
  }
  return { ok: true, section, reference: { topic: "progress", period, metric } };
}
