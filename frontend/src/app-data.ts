import type { PrivacySettings, ProfileFormValues } from "./types";

export const initialForm: ProfileFormValues = {
  age: 30,
  gender: "prefer_not_to_say",
  heightCm: 170,
  weightKg: 70,
  targetWeightKg: undefined,
  occupationType: "",
  activityLevel: "moderate",
  dietaryPreferences: [],
  dietaryRestrictions: [],
  fitnessGoal: "general_fitness",
  weeklyActivityDays: 3,
  exerciseTypes: [],
  sessionDuration: "30_60",
  fitnessLevel: "beginner",
  exerciseEnvironment: "home",
  exerciseTime: "morning",
  enduranceMinutes: 30,
  pushups: 0,
  squats: 0
};

export const initialPrivacy: PrivacySettings = {
  consentGiven: false,
  dataForRecommendations: false,
  publicVisibility: "private",
  emailNotifications: false,
  consentedAt: null
};

export const labels: Record<string, string> = {
  sedentary: "Sedentary",
  light: "Light",
  moderate: "Moderate",
  active: "Active",
  very_active: "Very active",
  weight_loss: "Weight loss",
  muscle_gain: "Muscle gain",
  general_fitness: "General fitness",
  cardio: "Cardio",
  strength: "Strength",
  flexibility: "Flexibility",
  sports: "Sports"
};

export const profileSteps = ["Basic", "Goals", "Fitness", "Data use"] as const;
