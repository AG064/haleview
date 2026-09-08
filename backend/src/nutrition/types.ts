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

export interface IngredientNutrition extends NutritionValues {
  calories: number;
  carbs: number;
  protein: number;
  fats: number;
}

export interface IngredientRecord {
  id: string;
  label: string;
  unit: NutritionUnit;
  quantity: number;
  nutrition: IngredientNutrition;
  category: string;
  allergens: string[];
  dietaryTags: string[];
  aliases: string[];
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

export interface MacroTargets {
  proteinG: number;
  carbsG: number;
  fatsG: number;
}

export interface NutritionPreferences {
  version: 1;
  dietaryPreferences: string[];
  allergies: string[];
  dislikedIngredients: string[];
  cuisinePreferences: string[];
  calorieTargetKcal: number;
  macroTargets: MacroTargets;
  mealsPerDay: number;
  snacksPerDay: number;
  mealTimes: string[];
  timezone: string;
  effectiveFrom: string;
}

export interface NutritionMeal {
  recipeId: string;
  servings: number;
}

export interface SearchFilters {
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

export interface RecipeSearchResult {
  recipe: RecipeRecord;
  nutrition: NutritionValues;
  relevance: number;
  matchedTerms: string[];
  enhancedNutrition: EnhancedNutritionProfile;
  community?: CommunityRecipeSignal;
  rankScore?: number;
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
