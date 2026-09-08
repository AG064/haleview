import type { HealthProfile } from "./profile.js";

export type RecommendationPriority = "high" | "medium" | "low";

export interface RecommendationItem {
  id: string;
  priority: RecommendationPriority;
  title: string;
  text: string;
}

export interface RecommendationSummary {
  weekly: string;
  monthly: string;
}

export interface Guidance {
  generatedAt: string;
  profileUpdatedAt: string;
  source: "local" | "deepseek";
  goal: string;
  items: RecommendationItem[];
  summaries: RecommendationSummary;
}

export interface GuidanceHistory {
  weights: Array<{ weightKg: number; recordedAt: string }>;
  activities: Array<{ activeDays: number; recordedAt: string }>;
  analytics?: Array<{
    wellnessScore: number;
    goalProgress: number;
    recordedAt: string;
  }>;
}

const goalLabels: Record<HealthProfile["fitnessGoal"], string> = {
  weight_loss: "Weight loss",
  muscle_gain: "Muscle gain",
  general_fitness: "General fitness"
};

function countSince<T extends { recordedAt: string }>(items: T[], days: number): T[] {
  const now = Date.now();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return items.filter((item) => {
    const recordedAt = Date.parse(item.recordedAt);
    return recordedAt >= cutoff && recordedAt <= now;
  });
}

function goalText(profile: HealthProfile): string {
  return `Goal: ${goalLabels[profile.fitnessGoal]}.`;
}

function progressText(profile: HealthProfile, history: GuidanceHistory): string {
  const analytics = [...(history.analytics ?? [])]
    .sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt));
  const previous = analytics[1];
  if (!previous) {
    return `Wellness score ${profile.analytics.wellnessScore}. No previous score is available. Goal progress ${profile.analytics.goalProgress}%.`;
  }
  const change = profile.analytics.wellnessScore - previous.wellnessScore;
  const changeText = change === 0
    ? "no change from the previous record"
    : `${Math.abs(change)} point${Math.abs(change) === 1 ? "" : "s"} ${change > 0 ? "higher" : "lower"} than the previous record`;
  return `Wellness score ${profile.analytics.wellnessScore}, ${changeText}. Goal progress ${profile.analytics.goalProgress}%.`;
}

function recordCount(count: number): string {
  return `${count} activity ${count === 1 ? "record" : "records"}`;
}

function activeDayCount(count: number): string {
  return `${count} active ${count === 1 ? "day" : "days"}`;
}

function weightChangeText(history: GuidanceHistory, days: number): string {
  const weights = countSince(history.weights, days)
    .sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt));
  if (weights.length < 2) {
    return "No weight change is available for this period.";
  }
  const change = weights[0].weightKg - weights[weights.length - 1].weightKg;
  const direction = change === 0 ? "did not change" : `changed by ${change > 0 ? "+" : ""}${change.toFixed(1)} kg`;
  return `Weight ${direction}.`;
}

export function buildGroundedSummaries(profile: HealthProfile, history: GuidanceHistory): RecommendationSummary {
  const recentActivities = countSince(history.activities, 7);
  const monthlyActivities = countSince(history.activities, 30);
  const recentDays = recentActivities.reduce((total, item) => total + item.activeDays, 0);
  const monthlyDays = monthlyActivities.reduce((total, item) => total + item.activeDays, 0);
  const progress = progressText(profile, history);

  return {
    weekly: `${goalText(profile)} ${progress} This week has ${recordCount(recentActivities.length)} and ${activeDayCount(recentDays)}. ${weightChangeText(history, 7)}`,
    monthly: `${goalText(profile)} ${progress} The last 30 days have ${recordCount(monthlyActivities.length)} and ${activeDayCount(monthlyDays)}. ${weightChangeText(history, 30)}`
  };
}

export function buildLocalGuidance(profile: HealthProfile, history: GuidanceHistory): Guidance {
  const goal = goalLabels[profile.fitnessGoal];
  const items: RecommendationItem[] = [];

  if (profile.analytics.bmiClassification === "underweight" || profile.analytics.bmiClassification === "obese") {
    items.push({
      id: "bmi-review",
      priority: "high",
      title: "Review BMI",
      text: `${goalText(profile)} Review this BMI result with a qualified health professional before changing your plan.`
    });
  }

  if (profile.weeklyActivityDays < 2) {
    items.push({
      id: "activity-start",
      priority: "high",
      title: "Set a small activity step",
      text: `${goalText(profile)} Start with one short session that fits your ${profile.exerciseEnvironment} routine.`
    });
  } else {
    items.push({
      id: "activity-keep",
      priority: "medium",
      title: "Keep the routine",
      text: `${goalText(profile)} Keep the planned ${profile.weeklyActivityDays} active days and record each session.`
    });
  }

  if (profile.targetWeightKg === undefined) {
    items.push({
      id: "target-weight",
      priority: "medium",
      title: "Add a target",
      text: `${goalText(profile)} Add a target weight if you want distance and progress values.`
    });
  } else {
    const distance = Math.abs(profile.weightKg - profile.targetWeightKg);
    items.push({
      id: "target-distance",
      priority: "low",
      title: "Check target distance",
      text: `${goalText(profile)} The current distance to the target is ${distance.toFixed(1)} kg. Review it when the weight record changes.`
    });
  }

  if (profile.dietaryRestrictions.length > 0) {
    items.push({
      id: "food-limits",
      priority: "low",
      title: "Keep food limits visible",
      text: `${goalText(profile)} Keep the listed dietary restrictions with the plan when choosing meals.`
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    profileUpdatedAt: profile.updatedAt,
    source: "local",
    goal,
    items: items.slice(0, 4),
    summaries: buildGroundedSummaries(profile, history)
  };
}
