import { NutritionValidationError } from "./units.js";
import type {
  IngredientRecord,
  MacroTargets,
  NutritionMeal,
  NutritionValues,
  RecipeRecord
} from "./types.js";
import type { NutritionUnit } from "./types.js";

const nutritionKeys: Array<keyof NutritionValues> = [
  "caloriesKcal",
  "proteinG",
  "carbsG",
  "fatsG",
  "fiberG",
  "sugarG",
  "sodiumMg",
  "vitaminDMcg",
  "vitaminB12Mcg",
  "ironMg",
  "calciumMg",
  "magnesiumMg"
];

function round(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function emptyNutrition(): NutritionValues {
  return {
    caloriesKcal: 0,
    proteinG: 0,
    carbsG: 0,
    fatsG: 0,
    fiberG: 0,
    sugarG: 0,
    sodiumMg: 0,
    vitaminDMcg: 0,
    vitaminB12Mcg: 0,
    ironMg: 0,
    calciumMg: 0,
    magnesiumMg: 0
  };
}

function addNutrition(target: NutritionValues, value: NutritionValues, multiplier = 1): void {
  for (const key of nutritionKeys) {
    target[key] = round(target[key] + value[key] * multiplier);
  }
}

function scaleNutrition(value: NutritionValues, multiplier: number): NutritionValues {
  const result = emptyNutrition();
  addNutrition(result, value, multiplier);
  return result;
}

function validateNutrition(value: NutritionValues): void {
  for (const key of nutritionKeys) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0) {
      throw new NutritionValidationError(`Nutrition value ${key} must be a non-negative number.`);
    }
  }
}

export function calculateIngredientNutrition(
  ingredient: IngredientRecord,
  quantity: number,
  unit: NutritionUnit
): NutritionValues {
  if (!ingredient || ingredient.unit !== unit) {
    throw new NutritionValidationError("Ingredient quantity uses a different standard unit.");
  }
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
    throw new NutritionValidationError("Ingredient quantity must be greater than zero.");
  }
  if (typeof ingredient.quantity !== "number" || ingredient.quantity <= 0) {
    throw new NutritionValidationError("Ingredient base quantity must be greater than zero.");
  }
  validateNutrition(ingredient.nutrition);
  const ratio = quantity / ingredient.quantity;
  const result = emptyNutrition();
  addNutrition(result, ingredient.nutrition, ratio);
  return result;
}

export function calculateRecipeNutrition(
  recipe: RecipeRecord,
  ingredientsById: Map<string, IngredientRecord>,
  servingsOverride?: number
): NutritionValues {
  if (!recipe || !Array.isArray(recipe.ingredients) || recipe.servings <= 0) {
    throw new NutritionValidationError("Recipe servings and ingredients are required.");
  }
  if (servingsOverride !== undefined && (servingsOverride <= 0 || !Number.isFinite(servingsOverride))) {
    throw new NutritionValidationError("Recipe servings must be greater than zero.");
  }
  const result = emptyNutrition();
  for (const item of recipe.ingredients) {
    const ingredient = ingredientsById.get(item.id);
    if (!ingredient) {
      throw new NutritionValidationError(`Ingredient ${item.id} is not in the catalogue.`);
    }
    addNutrition(result, calculateIngredientNutrition(ingredient, item.quantity, item.unit));
  }
  return servingsOverride === undefined ? result : scaleNutrition(result, servingsOverride / recipe.servings);
}

export function calculateMealNutrition(
  meal: NutritionMeal,
  recipesById: Map<string, RecipeRecord>,
  ingredientsById: Map<string, IngredientRecord>
): NutritionValues {
  const recipe = recipesById.get(meal.recipeId);
  if (!recipe) {
    throw new NutritionValidationError(`Recipe ${meal.recipeId} is not in the catalogue.`);
  }
  return calculateRecipeNutrition(recipe, ingredientsById, meal.servings);
}

export function calculateDayNutrition(
  meals: NutritionMeal[],
  recipesById: Map<string, RecipeRecord>,
  ingredientsById: Map<string, IngredientRecord>
): NutritionValues {
  if (!Array.isArray(meals)) {
    throw new NutritionValidationError("Meals must be a list.");
  }
  const result = emptyNutrition();
  for (const meal of meals) {
    addNutrition(result, calculateMealNutrition(meal, recipesById, ingredientsById));
  }
  return result;
}

export function macroPercentages(nutrition: NutritionValues, targets: MacroTargets): {
  protein: number;
  carbs: number;
  fats: number;
} {
  return {
    protein: targets.proteinG > 0 ? round((nutrition.proteinG / targets.proteinG) * 100) : 0,
    carbs: targets.carbsG > 0 ? round((nutrition.carbsG / targets.carbsG) * 100) : 0,
    fats: targets.fatsG > 0 ? round((nutrition.fatsG / targets.fatsG) * 100) : 0
  };
}
