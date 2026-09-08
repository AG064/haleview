export type NutritionUnit = "g" | "ml";

export interface NutritionValues {
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
  fiberG: number;
  sugarG: number;
  sodiumMg: number;
  vitaminDMcg: number;
  vitaminB12Mcg: number;
  ironMg: number;
  calciumMg: number;
  magnesiumMg: number;
}

export interface RecipeIngredient {
  id: string;
  name: string;
  quantity: number;
  unit: NutritionUnit;
}

export interface PreparationStep {
  step: number;
  description: string;
  ingredients: string[];
}

export interface RecipeImageCredit {
  creator: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
}

export interface RecipeRecord {
  planningWarning?: string;
  id: string;
  title: string;
  cuisine: string;
  meal: string;
  servings: number;
  ingredients: RecipeIngredient[];
  summary: string;
  time: number;
  difficulty_level: "easy" | "medium" | "hard";
  dietary_tags: string[];
  source: string;
  img: string;
  imageCredit?: RecipeImageCredit;
  preparation: PreparationStep[];
}

export interface RecipeSearchResult {
  recipe: RecipeRecord;
  nutrition: NutritionValues;
  relevance: number;
  matchedTerms: string[];
  enhancedNutrition: EnhancedNutritionProfile;
  community?: CommunityRecipeSignal;
  rankScore?: number;
}

export interface EnhancedNutritionProfile {
  nutrientDensityScore: number;
  satietyIndex: number;
  ingredientDiversity: number;
  calculationBasis: "catalogue_nutrients";
}

export interface CommunityRecipeSignal {
  recipeId: string;
  ratingCount: number;
  averageStars: number;
  helpfulCount: number;
  notHelpfulCount: number;
  score: number;
  verified: boolean;
}

export interface IngredientSubstitution {
  fromIngredientId: string;
  fromLabel: string;
  toIngredientId: string;
  toLabel: string;
  quantity: number;
  unit: NutritionUnit;
  reason: string;
}

export interface RecipeGroup {
  id: string;
  title: string;
  recipes: RecipeSearchResult[];
}

export interface RecipeCreation extends CustomRecipeResult {
  saved: boolean;
  mode: "describe" | "combine";
}

export interface CustomRecipeResult {
  recipe: RecipeRecord;
  nutrition: NutritionValues;
  enhancedNutrition: EnhancedNutritionProfile;
  source: "local" | "deepseek";
  model: string | null;
  baseRecipeIds: string[];
  substitutions: IngredientSubstitution[];
  nutritionFunction: "calculate_ingredient_list_nutrition";
  generatedAt: string;
}

export interface RecipeSearchFilters {
  query?: string;
  cuisine?: string;
  meal?: string;
  dietaryTags?: string[];
  allergies?: string[];
  excludedIngredients?: string[];
  maxCaloriesKcal?: number;
  maxProteinG?: number;
  maxCarbsG?: number;
  maxFatsG?: number;
  minFiberG?: number;
  maxSodiumMg?: number;
  minVitaminDMcg?: number;
  minVitaminB12Mcg?: number;
  minIronMg?: number;
  minCalciumMg?: number;
  minMagnesiumMg?: number;
  maxTimeMinutes?: number;
  limit?: number;
  offset?: number;
}

export interface NutritionPreferences {
  version: 1;
  dietaryPreferences: string[];
  allergies: string[];
  dislikedIngredients: string[];
  cuisinePreferences: string[];
  calorieTargetKcal: number;
  macroTargets: { proteinG: number; carbsG: number; fatsG: number };
  mealsPerDay: number;
  snacksPerDay: number;
  mealTimes: string[];
  timezone: string;
  effectiveFrom: string;
}

export type PlanDuration = "day" | "week";

export interface PlannedMeal {
  scheduledAt: string | null;
  id: string;
  date: string;
  order: number;
  mealType: string;
  time: string;
  recipeId: string | null;
  title: string;
  servings: number;
  nutrition: NutritionValues;
  source: "catalog" | "manual" | "generated";
  recipeSnapshot?: RecipeRecord;
  manual: boolean;
  reason: string;
  notes: string;
}

export interface MealPlanDay {
  date: string;
  meals: PlannedMeal[];
  nutrition: NutritionValues;
  review?: { status: "review" | "within_range"; gaps: string[]; excesses: string[]; needsCorrection: boolean; summary: string };
}

export interface MealPlan {
  timezone: string;
  id: string;
  duration: PlanDuration;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  source: "local" | "deepseek" | "cache";
  fallbackReason: string | null;
  model: string | null;
  generationSteps: string[];
  targets: {
    calorieTargetKcal: number;
    macroTargets: { proteinG: number; carbsG: number; fatsG: number };
  };
  days: MealPlanDay[];
  nutrition: NutritionValues;
  insights?: MealPlanInsights;
}

export interface MealPlanInsights {
  nutritionalBalanceScore: number;
  diversityIndex: number;
  micronutrientCoverage: {
    percentage: number;
    low: string[];
    high: string[];
  };
  weeklyTrends: {
    proteinConsistency: "high" | "moderate" | "variable";
    fiberTrend: "increasing" | "steady" | "decreasing";
    sugarTrend: "increasing" | "steady" | "decreasing";
  };
  calculationBasis: "catalogue_nutrients";
}

export interface MealPlanVersion {
  id: number;
  planId: string;
  version: number;
  label: string;
  createdAt: string;
  plan: MealPlan;
}

export type FoodGroup = "Produce" | "Protein" | "Dairy" | "Grains" | "Pantry" | "Drinks" | "Other";

export interface ShoppingItem {
  checked?: boolean;
  id: string;
  ingredientId: string;
  name: string;
  quantity: number;
  unit: NutritionUnit;
  group: FoodGroup;
}

export interface ShoppingList {
  id: string;
  planId: string;
  sourceType: "plan" | "meal";
  sourceId: string;
  createdAt: string;
  updatedAt: string;
  items: ShoppingItem[];
}

export type NutritionIntakeSource = "manual" | "plan" | "recipe";

export interface NutritionIntakeEntry {
  id: string;
  title: string;
  source: NutritionIntakeSource;
  sourceId: string | null;
  nutrition: NutritionValues;
}

export interface NutritionIntakeRecord {
  id: string;
  date: string;
  recordedAt: string;
  entries: NutritionIntakeEntry[];
  nutrition: NutritionValues;
}

export interface NutritionTargets {
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
  targets: NutritionTargets;
  calorieBalanceKcal: number;
  calorieStatus: "deficit" | "on_target" | "surplus";
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

export interface NutritionAdvice {
  source: "local" | "deepseek";
  model: string | null;
  text: string;
  suggestions: string[];
}

export interface NutritionProgressResult {
  generatedAt: string;
  targets: NutritionTargets;
  today: PeriodNutrition;
  week: PeriodNutrition;
  month: PeriodNutrition;
  trend: NutritionTrendPoint[];
  nutritionScore: number;
  wellnessScore: number;
  baseWellnessScore: number;
  micronutrients: Pick<NutritionValues, "fiberG" | "sodiumMg" | "vitaminDMcg" | "vitaminB12Mcg" | "ironMg" | "calciumMg" | "magnesiumMg">;
  micronutrientGuidance: MicronutrientGuidance[];
  summary: NutritionAdvice;
}

export interface MicronutrientGuidance {
  key: "fiberG" | "sodiumMg" | "vitaminDMcg" | "vitaminB12Mcg" | "ironMg" | "calciumMg" | "magnesiumMg";
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

export type FeedbackSubject = "recipe" | "ingredient" | "suggestion" | "meal_plan";
export type FeedbackRating = "helpful" | "not_helpful";
export type FeedbackDecision = "accepted" | "rejected" | "saved" | "none";

export interface NutritionFeedback {
  id: string;
  subjectType: FeedbackSubject;
  subjectId: string;
  rating: FeedbackRating;
  decision: FeedbackDecision;
  comment: string;
  stars: number;
  moderationStatus: "approved" | "rejected";
  moderationReason: string;
  createdAt: string;
}

export interface NutritionFeedbackSummary {
  total: number;
  helpful: number;
  notHelpful: number;
  accepted: number;
  rejected: number;
  saved: number;
}

export interface NutritionPreferenceHistory {
  id: number;
  version: number;
  preferences: NutritionPreferences;
  updatedAt: string;
}

export interface RecipeFavourite {
  recipe: RecipeRecord;
  nutrition: NutritionValues;
  enhancedNutrition: EnhancedNutritionProfile;
  creation?: RecipeCreation;
}
