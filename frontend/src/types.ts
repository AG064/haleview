export const activityLevels = [
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active"
] as const;

export const fitnessGoals = ["weight_loss", "muscle_gain", "general_fitness"] as const;
export const exerciseTypes = ["cardio", "strength", "flexibility", "sports"] as const;

export type ActivityLevel = (typeof activityLevels)[number];
export type FitnessGoal = (typeof fitnessGoals)[number];
export type ExerciseType = (typeof exerciseTypes)[number];
export type PublicVisibility = "private" | "summary";

export interface ProfileFormValues {
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
  sessionDuration: "15_30" | "30_60" | "60_plus";
  fitnessLevel: "beginner" | "intermediate" | "advanced";
  exerciseEnvironment: "home" | "gym" | "outdoors";
  exerciseTime: "morning" | "afternoon" | "evening";
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

export interface HealthProfile extends ProfileFormValues {
  updatedAt: string;
  analytics: HealthAnalytics;
}

export interface WeightHistoryRecord {
  id: number;
  weightKg: number;
  recordedAt: string;
}

export interface ActivityHistoryRecord {
  id: number;
  activeDays: number;
  recordedAt: string;
}

export interface AnalyticsHistoryRecord {
  id: number;
  wellnessScore: number;
  bmi: number;
  bmiScore: number;
  activityScore: number;
  goalProgress: number;
  habitsScore: number;
  recordedAt: string;
}

export interface HealthHistory {
  weights: WeightHistoryRecord[];
  activities: ActivityHistoryRecord[];
  analytics: AnalyticsHistoryRecord[];
}

export interface PrivacySettings {
  consentGiven: boolean;
  dataForRecommendations: boolean;
  publicVisibility: PublicVisibility;
  emailNotifications: boolean;
  consentedAt: string | null;
}

export type RecommendationPriority = "high" | "medium" | "low";

export interface RecommendationItem {
  id: string;
  priority: RecommendationPriority;
  title: string;
  text: string;
}

export interface Guidance {
  generatedAt: string;
  profileUpdatedAt: string;
  source: "local" | "deepseek";
  goal: string;
  items: RecommendationItem[];
  summaries: {
    weekly: string;
    monthly: string;
  };
}
