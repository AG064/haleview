import { readFileSync } from "node:fs";
import { calculateRecipeNutrition } from "./calculator.js";
import { recipePlanningWarning } from "./planning-quality.js";
import { cosineSimilarity, embedText } from "./embeddings.js";
import { enhancedNutritionProfile } from "./micronutrients.js";
import { assertStandardUnit, NutritionValidationError } from "./units.js";
import type {
  IngredientRecord,
  IngredientNutrition,
  NutritionValues,
  RecipeRecord,
  RecipeSearchResult,
  SearchFilters
} from "./types.js";

export class CatalogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogValidationError";
  }
}

function readJson(path: URL): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new CatalogValidationError(`Catalogue data could not be read: ${String(error)}`);
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CatalogValidationError(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, maximum = 240): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maximum) {
    throw new CatalogValidationError(`${field} must be a non-empty text value.`);
  }
  return value.trim();
}

function positiveNumber(value: unknown, field: string, maximum = 100000): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new CatalogValidationError(`${field} must be greater than zero.`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, field: string, maximum = 1000000): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new CatalogValidationError(`${field} must be a non-negative number.`);
  }
  return value;
}

function stringList(value: unknown, field: string, maximum = 40): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new CatalogValidationError(`${field} must be a list.`);
  }
  return value.map((item) => text(item, field, 80));
}

function optionalImageCredit(value: unknown, field: string): RecipeRecord["imageCredit"] {
  if (value === undefined) return undefined;
  const item = record(value, field);
  return {
    creator: text(item.creator, `${field} creator`, 160),
    license: text(item.license, `${field} license`, 80),
    licenseUrl: text(item.licenseUrl, `${field} license URL`, 500),
    sourceUrl: text(item.sourceUrl, `${field} source URL`, 500),
  };
}

function nutrition(value: unknown): IngredientNutrition {
  const item = record(value, "nutrition");
  const values = {
    caloriesKcal: nonNegativeNumber(item.caloriesKcal, "caloriesKcal"),
    proteinG: nonNegativeNumber(item.proteinG, "proteinG"),
    carbsG: nonNegativeNumber(item.carbsG, "carbsG"),
    fatsG: nonNegativeNumber(item.fatsG, "fatsG"),
    fiberG: nonNegativeNumber(item.fiberG, "fiberG"),
    sugarG: nonNegativeNumber(item.sugarG, "sugarG"),
    sodiumMg: nonNegativeNumber(item.sodiumMg, "sodiumMg"),
    vitaminDMcg: nonNegativeNumber(item.vitaminDMcg, "vitaminDMcg"),
    vitaminB12Mcg: nonNegativeNumber(item.vitaminB12Mcg, "vitaminB12Mcg"),
    ironMg: nonNegativeNumber(item.ironMg, "ironMg"),
    calciumMg: nonNegativeNumber(item.calciumMg, "calciumMg"),
    magnesiumMg: nonNegativeNumber(item.magnesiumMg, "magnesiumMg")
  };
  const aliases = {
    calories: nonNegativeNumber(item.calories, "calories"),
    carbs: nonNegativeNumber(item.carbs, "carbs"),
    protein: nonNegativeNumber(item.protein, "protein"),
    fats: nonNegativeNumber(item.fats, "fats"),
  };
  if (aliases.calories !== values.caloriesKcal || aliases.carbs !== values.carbsG || aliases.protein !== values.proteinG || aliases.fats !== values.fatsG) {
    throw new CatalogValidationError("Ingredient nutrition field names must describe the same values.");
  }
  return { ...values, ...aliases };
}

function validateIngredients(value: unknown): IngredientRecord[] {
  if (!Array.isArray(value)) {
    throw new CatalogValidationError("Ingredients catalogue must be a list.");
  }
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const item = record(raw, `ingredient ${index + 1}`);
    const id = text(item.id, "ingredient id", 80);
    if (ids.has(id)) {
      throw new CatalogValidationError(`Ingredient id ${id} is repeated.`);
    }
    ids.add(id);
    return {
      id,
      label: text(item.label, "ingredient label", 120),
      unit: assertStandardUnit(item.unit),
      quantity: positiveNumber(item.quantity, "ingredient quantity"),
      nutrition: nutrition(item.nutrition),
      category: text(item.category, "ingredient category", 60),
      allergens: stringList(item.allergens, "ingredient allergens"),
      dietaryTags: stringList(item.dietaryTags, "ingredient dietary tags"),
      aliases: stringList(item.aliases, "ingredient aliases")
    };
  });
}

function validateRecipes(value: unknown, ingredientsById: Map<string, IngredientRecord>): RecipeRecord[] {
  if (!Array.isArray(value)) {
    throw new CatalogValidationError("Recipes catalogue must be a list.");
  }
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const item = record(raw, `recipe ${index + 1}`);
    const id = text(item.id, "recipe id", 80);
    if (ids.has(id)) {
      throw new CatalogValidationError(`Recipe id ${id} is repeated.`);
    }
    ids.add(id);
    const rawIngredients = item.ingredients;
    if (!Array.isArray(rawIngredients) || rawIngredients.length === 0 || rawIngredients.length > 20) {
      throw new CatalogValidationError(`Recipe ${id} must have one to twenty ingredients.`);
    }
    const ingredients = rawIngredients.map((rawIngredient) => {
      const ingredient = record(rawIngredient, `recipe ${id} ingredient`);
      const ingredientId = text(ingredient.id, "recipe ingredient id", 80);
      const storedIngredient = ingredientsById.get(ingredientId);
      if (!storedIngredient) {
        throw new CatalogValidationError(`Recipe ${id} refers to missing ingredient ${ingredientId}.`);
      }
      const unit = assertStandardUnit(ingredient.unit);
      if (unit !== storedIngredient.unit) {
        throw new CatalogValidationError(`Recipe ${id} uses the wrong unit for ingredient ${ingredientId}.`);
      }
      return {
        id: ingredientId,
        name: text(ingredient.name, "recipe ingredient name", 120),
        quantity: positiveNumber(ingredient.quantity, "recipe ingredient quantity"),
        unit
      };
    });
    const rawPreparation = item.preparation;
    if (!Array.isArray(rawPreparation) || rawPreparation.length === 0 || rawPreparation.length > 20) {
      throw new CatalogValidationError(`Recipe ${id} must have preparation steps.`);
    }
    const preparation = rawPreparation.map((rawStep, stepIndex) => {
      const step = record(rawStep, `recipe ${id} step`);
      const referenced = stringList(step.ingredients, `recipe ${id} step ingredients`, 20);
      if (referenced.some((ingredientId) => !ingredientsById.has(ingredientId))) {
        throw new CatalogValidationError(`Recipe ${id} has a preparation reference to a missing ingredient.`);
      }
      return {
        step: stepIndex + 1,
        description: text(step.description, "preparation description", 500),
        ingredients: referenced
      };
    });
    const difficulty = item.difficulty_level;
    if (difficulty !== "easy" && difficulty !== "medium" && difficulty !== "hard") {
      throw new CatalogValidationError(`Recipe ${id} has an invalid difficulty level.`);
    }
    return {
      id,
      title: text(item.title, "recipe title", 160),
      cuisine: text(item.cuisine, "recipe cuisine", 80),
      meal: text(item.meal, "recipe meal", 40),
      servings: positiveNumber(item.servings, "recipe servings", 100),
      ingredients,
      summary: text(item.summary, "recipe summary", 500),
      time: positiveNumber(item.time, "recipe time", 1440),
      difficulty_level: difficulty,
      dietary_tags: stringList(item.dietary_tags, "recipe dietary tags"),
      source: text(item.source, "recipe source", 160),
      img: text(item.img, "recipe image", 500),
      imageCredit: optionalImageCredit(item.imageCredit, "recipe image credit"),
      preparation
    };
  });
}

const rawIngredients = readJson(new URL("./data/ingredients.json", import.meta.url));
const ingredients = validateIngredients(rawIngredients);
const ingredientMap = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
const rawRecipes = readJson(new URL("./data/recipes.json", import.meta.url));
const recipes = validateRecipes(rawRecipes, ingredientMap).map(recipe => ({ ...recipe, planningWarning: recipePlanningWarning(recipe) }));
const recipeMap = new Map(recipes.map((recipe) => [recipe.id, recipe]));
const recipeEmbeddings = new Map(recipes.map((recipe) => [recipe.id, embedText(recipeText(recipe))]));

if (ingredients.length < 500 || recipes.length < 500) {
  throw new CatalogValidationError("The nutrition catalogue must contain at least 500 ingredients and 500 recipes.");
}

const searchStopWords = new Set([
  "a", "an", "and", "create", "for", "from", "ingredient", "make", "of", "please", "quick",
  "recipe", "safe", "the", "variation", "want", "with",
]);

function tokens(value: string): string[] {
  return value.toLocaleLowerCase("en-US").split(/[^a-z0-9]+/u).filter((token) => (
    token.length > 1 && /[a-z]/u.test(token) && !searchStopWords.has(token)
  ));
}

function recipeText(recipe: RecipeRecord): string {
  const ingredientText = recipe.ingredients.map((item) => `${item.name} ${item.id}`).join(" ");
  return [recipe.title, recipe.cuisine, recipe.meal, recipe.summary, recipe.dietary_tags.join(" "), ingredientText].join(" ");
}

function normaliseLimit(value: number | undefined, defaultValue: number, maximum: number): number {
  if (value === undefined) return defaultValue;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new NutritionValidationError(`Limit must be a whole number from 1 to ${maximum}.`);
  }
  return value;
}

function normaliseOffset(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new NutritionValidationError("Offset must be a whole number from 0 to 10000.");
  }
  return value;
}

function hasExcludedIngredient(recipe: RecipeRecord, excluded: string[]): boolean {
  return recipe.ingredients.some((item) => {
    const ingredient = ingredientMap.get(item.id);
    const values = [item.id, item.name, ingredient?.label ?? "", ...(ingredient?.aliases ?? [])].map((value) => value.toLowerCase());
    return excluded.some((term) => values.some((value) => value.includes(term.toLowerCase())));
  });
}

function hasAllergy(recipe: RecipeRecord, allergies: string[]): boolean {
  return recipe.ingredients.some((item) => ingredientMap.get(item.id)?.allergens.some((allergen) => allergies.includes(allergen)) ?? false);
}

export function recipeMeetsFoodRestrictions(
  recipe: RecipeRecord,
  options: { dietaryTags?: string[]; allergies?: string[]; excludedIngredients?: string[] },
): boolean {
  if (options.dietaryTags?.some((tag) => !recipe.dietary_tags.includes(tag))) return false;
  if (options.allergies && hasAllergy(recipe, options.allergies)) return false;
  if (options.excludedIngredients && hasExcludedIngredient(recipe, options.excludedIngredients)) return false;
  return true;
}

export function getCatalogStats(): { ingredients: number; recipes: number; source: string; embeddingDimensions: number } {
  return { ingredients: ingredients.length, recipes: recipes.length, source: "open-recipe-archive-and-haleview-templates", embeddingDimensions: 48 };
}

export function getIngredient(id: string): IngredientRecord | undefined {
  return ingredientMap.get(id);
}

export function getCatalogIngredients(): readonly IngredientRecord[] {
  return ingredients;
}

export function getRecipe(id: string): RecipeRecord | undefined {
  return recipeMap.get(id);
}

export function getRecipeNutrition(recipe: RecipeRecord, servings = 1): NutritionValues {
  return calculateRecipeNutrition(recipe, ingredientMap, servings);
}

export function getRecipeEnhancedNutrition(recipe: RecipeRecord, nutrition: NutritionValues) {
  return enhancedNutritionProfile(nutrition, recipe.ingredients.map((item) => item.id));
}

export function searchIngredients(query = "", limit = 20): IngredientRecord[] {
  const cleanQuery = query.trim().toLowerCase();
  const result = ingredients.filter((ingredient) => {
    if (!cleanQuery) return true;
    return [ingredient.id, ingredient.label, ...ingredient.aliases].some((value) => value.toLowerCase().includes(cleanQuery));
  });
  return result.slice(0, normaliseLimit(limit, 20, 100));
}

export function findCatalogIngredientAlternatives(
  ingredientId: string,
  options: { allergies?: string[]; excludedIngredients?: string[]; dietaryTags?: string[]; limit?: number } = {},
): IngredientRecord[] {
  const original = getIngredient(ingredientId);
  if (!original) throw new NutritionValidationError("The recipe ingredient is not in the catalogue.");
  const allergies = new Set((options.allergies ?? []).map((value) => value.toLowerCase()));
  const excluded = (options.excludedIngredients ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);
  const requiredTags = options.dietaryTags ?? [];
  const result = ingredients.filter((candidate) => {
    if (candidate.id === original.id || candidate.unit !== original.unit || candidate.category !== original.category) return false;
    if (candidate.allergens.some((allergen) => allergies.has(allergen.toLowerCase()))) return false;
    if (requiredTags.some((tag) => !candidate.dietaryTags.includes(tag))) return false;
    const names = [candidate.id, candidate.label, ...candidate.aliases].map((value) => value.toLowerCase());
    return !excluded.some((term) => names.some((name) => name.includes(term)));
  });
  result.sort((left, right) => {
    const leftDifference = Math.abs(left.nutrition.caloriesKcal - original.nutrition.caloriesKcal) + Math.abs(left.nutrition.proteinG - original.nutrition.proteinG) * 4;
    const rightDifference = Math.abs(right.nutrition.caloriesKcal - original.nutrition.caloriesKcal) + Math.abs(right.nutrition.proteinG - original.nutrition.proteinG) * 4;
    return leftDifference - rightDifference || left.label.localeCompare(right.label, "en");
  });
  return result.slice(0, normaliseLimit(options.limit, 5, 20));
}

export function searchRecipeCandidates(filters: SearchFilters = {}): RecipeSearchResult[] {
  const query = filters.query?.trim() ?? "";
  if (query.length > 160) {
    throw new NutritionValidationError("Recipe search text is too long.");
  }
  const queryTokens = tokens(query);
  const queryEmbedding = query ? embedText(query) : [];
  const candidates = recipes.flatMap((recipe) => {
    const lowerCuisine = recipe.cuisine.toLowerCase();
    const lowerMeal = recipe.meal.toLowerCase();
    if (filters.cuisine && !lowerCuisine.includes(filters.cuisine.toLowerCase())) return [];
    if (filters.meal && lowerMeal !== filters.meal.toLowerCase()) return [];
    if (filters.dietaryTags?.some((tag) => !recipe.dietary_tags.includes(tag))) return [];
    if (filters.allergies && hasAllergy(recipe, filters.allergies)) return [];
    if (filters.excludedIngredients && hasExcludedIngredient(recipe, filters.excludedIngredients)) return [];
    if (filters.maxTimeMinutes !== undefined && recipe.time > filters.maxTimeMinutes) return [];
    const nutrition = getRecipeNutrition(recipe, 1);
    if (filters.maxCaloriesKcal !== undefined && nutrition.caloriesKcal > filters.maxCaloriesKcal) return [];
    if (filters.maxProteinG !== undefined && nutrition.proteinG > filters.maxProteinG) return [];
    if (filters.maxCarbsG !== undefined && nutrition.carbsG > filters.maxCarbsG) return [];
    if (filters.maxFatsG !== undefined && nutrition.fatsG > filters.maxFatsG) return [];
    if (filters.minFiberG !== undefined && nutrition.fiberG < filters.minFiberG) return [];
    if (filters.maxSodiumMg !== undefined && nutrition.sodiumMg > filters.maxSodiumMg) return [];
    if (filters.minVitaminDMcg !== undefined && nutrition.vitaminDMcg < filters.minVitaminDMcg) return [];
    if (filters.minVitaminB12Mcg !== undefined && nutrition.vitaminB12Mcg < filters.minVitaminB12Mcg) return [];
    if (filters.minIronMg !== undefined && nutrition.ironMg < filters.minIronMg) return [];
    if (filters.minCalciumMg !== undefined && nutrition.calciumMg < filters.minCalciumMg) return [];
    if (filters.minMagnesiumMg !== undefined && nutrition.magnesiumMg < filters.minMagnesiumMg) return [];
    const textValue = recipeText(recipe);
    const lowerText = textValue.toLowerCase();
    const matchedTerms = queryTokens.filter((token) => lowerText.includes(token));
    const tokenScore = queryTokens.length === 0 ? 0 : matchedTerms.length / queryTokens.length;
    const semanticScore = query ? (cosineSimilarity(queryEmbedding, recipeEmbeddings.get(recipe.id) ?? []) + 1) / 2 : 0;
    const relevance = query ? Math.round((semanticScore * 0.55 + tokenScore * 0.45) * 1000000) / 1000000 : 0;
    return [{
      recipe,
      nutrition,
      relevance,
      matchedTerms,
      enhancedNutrition: getRecipeEnhancedNutrition(recipe, nutrition),
    }];
  });
  candidates.sort((first, second) => {
    const relevanceDifference = second.relevance - first.relevance;
    if (relevanceDifference !== 0) return relevanceDifference;
    if (!query) {
      const photoDifference = Number(Boolean(second.recipe.imageCredit)) - Number(Boolean(first.recipe.imageCredit));
      if (photoDifference !== 0) return photoDifference;
    }
    return first.recipe.title.localeCompare(second.recipe.title, "en");
  });
  return candidates;
}

export function searchRecipes(filters: SearchFilters = {}): RecipeSearchResult[] {
  const offset = normaliseOffset(filters.offset);
  const limit = normaliseLimit(filters.limit, 20, 50);
  return searchRecipeCandidates(filters).slice(offset, offset + limit);
}
