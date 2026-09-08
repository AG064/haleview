import { calculateIngredientNutrition } from "./calculator.js";
import { getIngredient, getRecipe, getRecipeNutrition } from "./catalog.js";
import { NutritionGenerationError } from "./errors.js";
import type { NutritionUnit, NutritionValues } from "./types.js";

export type NutritionFunctionName =
  | "calculate_ingredient_list_nutrition"
  | "calculate_recipe_nutrition"
  | "scale_recipe"
  | "calculate_meal_nutrition"
  | "calculate_day_nutrition";

export interface NutritionFunctionDefinition {
  name: NutritionFunctionName;
  description: string;
  parameters: Record<string, unknown>;
}

export interface NutritionFunctionCall {
  name: string;
  arguments: unknown;
}

export interface NutritionFunctionResult {
  functionName: NutritionFunctionName;
  source: "backend_function";
  value: Record<string, unknown>;
}

const recipeParameters = {
  type: "object",
  additionalProperties: false,
  required: ["recipeId", "servings"],
  properties: {
    recipeId: { type: "string", minLength: 1, maxLength: 80 },
    servings: { type: "number", exclusiveMinimum: 0, maximum: 100 },
  },
};

export const nutritionFunctionDefinitions: readonly NutritionFunctionDefinition[] = [
  {
    name: "calculate_ingredient_list_nutrition",
    description: "Calculate nutrition from catalogue ingredient identifiers, quantities, and standard units.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["ingredients"],
      properties: {
        ingredients: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "quantity", "unit"],
            properties: {
              id: { type: "string", minLength: 1, maxLength: 80 },
              quantity: { type: "number", exclusiveMinimum: 0, maximum: 1000000 },
              unit: { type: "string", enum: ["g", "ml"] },
            },
          },
        },
      },
    },
  },
  {
    name: "calculate_recipe_nutrition",
    description: "Calculate nutrition for a stored recipe and serving amount.",
    parameters: recipeParameters,
  },
  {
    name: "scale_recipe",
    description: "Scale stored recipe ingredients and nutrition to a serving amount.",
    parameters: recipeParameters,
  },
  {
    name: "calculate_meal_nutrition",
    description: "Calculate one meal from a stored recipe and serving amount.",
    parameters: recipeParameters,
  },
  {
    name: "calculate_day_nutrition",
    description: "Calculate a day total from stored recipe identifiers and serving amounts.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["meals"],
      properties: {
        meals: {
          type: "array",
          minItems: 1,
          maxItems: 16,
          items: recipeParameters,
        },
      },
    },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyProperties(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function recipeArguments(value: unknown): { recipeId: string; servings: number } {
  if (
    !isRecord(value)
    || !hasOnlyProperties(value, ["recipeId", "servings"])
    || typeof value.recipeId !== "string"
    || value.recipeId.trim().length === 0
    || value.recipeId.trim().length > 80
  ) {
    throw new NutritionGenerationError("invalid_parameters", "Recipe id is required.", 400, false);
  }
  if (typeof value.servings !== "number" || !Number.isFinite(value.servings) || value.servings <= 0 || value.servings > 100) {
    throw new NutritionGenerationError("invalid_parameters", "Servings must be a number greater than zero.", 400, false);
  }
  return { recipeId: value.recipeId.trim(), servings: value.servings };
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
    magnesiumMg: 0,
  };
}

function addNutrition(target: NutritionValues, value: NutritionValues): void {
  for (const key of Object.keys(target) as Array<keyof NutritionValues>) {
    target[key] = Math.round((target[key] + value[key]) * 1000000) / 1000000;
  }
}

function ingredientArguments(value: unknown): Array<{ id: string; quantity: number; unit: NutritionUnit }> {
  if (
    !isRecord(value)
    || !hasOnlyProperties(value, ["ingredients"])
    || !Array.isArray(value.ingredients)
    || value.ingredients.length < 1
    || value.ingredients.length > 20
  ) {
    throw new NutritionGenerationError("invalid_parameters", "Ingredients must contain one to twenty items.", 400, false);
  }
  return value.ingredients.map((raw) => {
    if (
      !isRecord(raw)
      || !hasOnlyProperties(raw, ["id", "quantity", "unit"])
      || typeof raw.id !== "string"
      || raw.id.trim().length === 0
      || raw.id.trim().length > 80
    ) {
      throw new NutritionGenerationError("invalid_parameters", "Every ingredient needs an id.", 400, false);
    }
    if (
      typeof raw.quantity !== "number"
      || !Number.isFinite(raw.quantity)
      || raw.quantity <= 0
      || raw.quantity > 1000000
    ) {
      throw new NutritionGenerationError("invalid_parameters", "Every ingredient quantity must be greater than zero and at most one million.", 400, false);
    }
    if (raw.unit !== "g" && raw.unit !== "ml") {
      throw new NutritionGenerationError("invalid_parameters", "Every ingredient unit must be g or ml.", 400, false);
    }
    return { id: raw.id.trim(), quantity: raw.quantity, unit: raw.unit };
  });
}

function dayArguments(value: unknown): Array<{ recipeId: string; servings: number }> {
  if (
    !isRecord(value)
    || !hasOnlyProperties(value, ["meals"])
    || !Array.isArray(value.meals)
    || value.meals.length < 1
    || value.meals.length > 16
  ) {
    throw new NutritionGenerationError("invalid_parameters", "Meals must contain one to sixteen items.", 400, false);
  }
  return value.meals.map(recipeArguments);
}

function recipeResult(name: "calculate_recipe_nutrition" | "calculate_meal_nutrition", value: unknown): NutritionFunctionResult {
  const input = recipeArguments(value);
  const recipe = getRecipe(input.recipeId);
  if (!recipe) {
    throw new NutritionGenerationError("missing_ingredient", "A requested ingredient or recipe is not available.", 404, true);
  }
  return {
    functionName: name,
    source: "backend_function",
    value: {
      recipeId: recipe.id,
      servings: input.servings,
      nutrition: getRecipeNutrition(recipe, input.servings),
    },
  };
}

function executeAllowlistedFunction(call: NutritionFunctionCall): NutritionFunctionResult {
  if (call.name === "calculate_ingredient_list_nutrition") {
    const ingredients = ingredientArguments(call.arguments);
    const nutrition = emptyNutrition();
    for (const item of ingredients) {
      const ingredient = getIngredient(item.id);
      if (!ingredient) {
        throw new NutritionGenerationError("missing_ingredient", "A requested ingredient or recipe is not available.", 404, true);
      }
      addNutrition(nutrition, calculateIngredientNutrition(ingredient, item.quantity, item.unit));
    }
    return {
      functionName: call.name,
      source: "backend_function",
      value: { ingredients, nutrition },
    };
  }
  if (call.name === "calculate_recipe_nutrition" || call.name === "calculate_meal_nutrition") {
    return recipeResult(call.name, call.arguments);
  }
  if (call.name === "scale_recipe") {
    const input = recipeArguments(call.arguments);
    const recipe = getRecipe(input.recipeId);
    if (!recipe) {
      throw new NutritionGenerationError("missing_ingredient", "A requested ingredient or recipe is not available.", 404, true);
    }
    const ratio = input.servings / recipe.servings;
    return {
      functionName: call.name,
      source: "backend_function",
      value: {
        recipe: {
          ...recipe,
          servings: input.servings,
          ingredients: recipe.ingredients.map((ingredient) => ({
            ...ingredient,
            quantity: Math.round(ingredient.quantity * ratio * 1000000) / 1000000,
          })),
        },
        nutrition: getRecipeNutrition(recipe, input.servings),
      },
    };
  }
  if (call.name === "calculate_day_nutrition") {
    const meals = dayArguments(call.arguments);
    const nutrition = emptyNutrition();
    for (const meal of meals) {
      const recipe = getRecipe(meal.recipeId);
      if (!recipe) {
        throw new NutritionGenerationError("missing_ingredient", "A requested ingredient or recipe is not available.", 404, true);
      }
      addNutrition(nutrition, getRecipeNutrition(recipe, meal.servings));
    }
    return {
      functionName: call.name,
      source: "backend_function",
      value: { meals, nutrition },
    };
  }
  throw new NutritionGenerationError("unknown_function", "The requested nutrition function is not available.", 400, false);
}

export function executeNutritionFunction(call: NutritionFunctionCall): NutritionFunctionResult {
  try {
    return executeAllowlistedFunction(call);
  } catch (error) {
    if (error instanceof NutritionGenerationError) {
      throw error;
    }
    throw new NutritionGenerationError("calculation_failed", "Nutrition could not be calculated.", 500, true);
  }
}
