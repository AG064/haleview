import { createHash, randomUUID } from "node:crypto";
import { findCatalogIngredientAlternatives, getIngredient, getRecipe, getRecipeEnhancedNutrition, recipeMeetsFoodRestrictions } from "./catalog.js";
import { executeNutritionFunction } from "./function-calling.js";
import { NutritionGenerationError } from "./errors.js";
import { buildRecipePrompt } from "./recipe-prompts.js";
import { restrictiveDietaryTags, dietaryStylePreferences } from "./dietary-policy.js";
import type { NutritionProvider } from "./provider.js";
import { buildRecipeRetrievalContext } from "./rag.js";
import type {
  CustomRecipeResult,
  IngredientSubstitution,
  NutritionPreferences,
  NutritionValues,
  RecipeIngredient,
  RecipeRecord,
} from "./types.js";

export interface CustomRecipeSubstitutionInput {
  fromIngredientId: string;
  toIngredientId: string;
}

export interface CustomRecipeRequest {
  query: string;
  baseRecipeId?: string;
  servings?: number;
  substitutions?: CustomRecipeSubstitutionInput[];
}

export interface IngredientSubstitutionResult {
  recipeId: string;
  ingredientId: string;
  source: "local" | "deepseek";
  model: string | null;
  alternatives: IngredientSubstitution[];
}

export interface CustomRecipeOptions {
  userId: number;
  preferences: NutritionPreferences;
  provider?: NutritionProvider | null;
  now?: () => Date;
}

export class CustomRecipeError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "CustomRecipeError";
  }
}

function cleanQuery(value: unknown): string {
  if (typeof value !== "string") throw new CustomRecipeError("Describe the recipe you want.");
  const clean = value.trim();
  if (!clean || clean.length > 160) throw new CustomRecipeError("Recipe text must have from 1 to 160 characters.");
  return clean;
}

function cleanServings(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.25 || value > 100) {
    throw new CustomRecipeError("Recipe amount must be from 0.25 to 100.");
  }
  return value;
}

const nutritionTags = new Set(["high_protein", "low_fat", "low_sodium"]);

function generationTags(preferences: NutritionPreferences): string[] {
  return restrictiveDietaryTags(preferences.dietaryPreferences);
}

function alternativeRecords(recipe: RecipeRecord, ingredientId: string, preferences: NutritionPreferences): IngredientSubstitution[] {
  const original = recipe.ingredients.find((item) => item.id === ingredientId);
  if (!original) throw new CustomRecipeError("The selected ingredient is not in this recipe.", 404);
  const originalRecord = getIngredient(original.id);
  if (!originalRecord) throw new CustomRecipeError("The selected ingredient is not available.", 404);
  return findCatalogIngredientAlternatives(original.id, {
    allergies: preferences.allergies,
    excludedIngredients: preferences.dislikedIngredients,
    dietaryTags: generationTags(preferences).filter((tag) => !nutritionTags.has(tag)),
    limit: 8,
  }).map((candidate) => ({
    fromIngredientId: original.id,
    fromLabel: original.name,
    toIngredientId: candidate.id,
    toLabel: candidate.label,
    quantity: original.quantity,
    unit: original.unit,
    reason: `Uses another ${originalRecord.category} ingredient with the same standard unit.`,
  })).filter((candidate) => {
    const adjusted = customRecipe(recipe, recipe.servings, [candidate]);
    return generationTags(preferences).filter((tag) => nutritionTags.has(tag)).every((tag) => adjusted.dietary_tags.includes(tag));
  });
}

export async function getIngredientSubstitutions(
  recipeId: string,
  ingredientId: string,
  options: CustomRecipeOptions,
): Promise<IngredientSubstitutionResult> {
  const recipe = getRecipe(recipeId);
  if (!recipe) throw new CustomRecipeError("Recipe not found.", 404);
  const alternatives = alternativeRecords(recipe, ingredientId, options.preferences);
  if (!options.provider || alternatives.length < 2) {
    return { recipeId, ingredientId, source: "local", model: null, alternatives };
  }
  try {
    const prompt = buildRecipePrompt("ingredient_substitution", {
      recipe, selectedIngredient: recipe.ingredients.find((item) => item.id === ingredientId),
      allowedAlternatives: alternatives,
      preferences: options.preferences,
      availability: "Only listed catalogue alternatives are available; pantry stock is unknown.",
    });
    const completion = await options.provider.complete(prompt);
    const ids = completion.content.ingredientIds;
    if (!Array.isArray(ids) || ids.length !== alternatives.length
      || ids.some((id) => typeof id !== "string" || !alternatives.some((item) => item.toIngredientId === id))
      || new Set(ids).size !== ids.length) {
      return { recipeId, ingredientId, source: "local", model: null, alternatives };
    }
    const order = new Map(ids.map((id, index) => [id, index]));
    return {
      recipeId,
      ingredientId,
      source: "deepseek",
      model: completion.model,
      alternatives: [...alternatives].sort((left, right) => (order.get(left.toIngredientId) ?? 999) - (order.get(right.toIngredientId) ?? 999)),
    };
  } catch {
    return { recipeId, ingredientId, source: "local", model: null, alternatives };
  }
}

function validatedSubstitutions(
  recipe: RecipeRecord,
  requested: CustomRecipeSubstitutionInput[],
  preferences: NutritionPreferences,
): IngredientSubstitution[] {
  if (!Array.isArray(requested)) throw new CustomRecipeError("Substitutions must be an array.");
  if (requested.length > 8) throw new CustomRecipeError("A custom recipe can have at most eight substitutions.");
  const seen = new Set<string>();
  return requested.map((item) => {
    if (!item || typeof item.fromIngredientId !== "string" || typeof item.toIngredientId !== "string") {
      throw new CustomRecipeError("Every substitution needs two catalogue ingredient identifiers.");
    }
    if (seen.has(item.fromIngredientId)) throw new CustomRecipeError("Each ingredient can be replaced once.");
    seen.add(item.fromIngredientId);
    const allowed = alternativeRecords(recipe, item.fromIngredientId, preferences);
    const match = allowed.find((candidate) => candidate.toIngredientId === item.toIngredientId);
    if (!match) throw new CustomRecipeError("The selected substitution does not meet the saved food restrictions.");
    return match;
  });
}

function replaceText(value: string, substitutions: IngredientSubstitution[]): string {
  return substitutions.reduce((current, item) => current.replaceAll(item.fromLabel, item.toLabel), value);
}

function customRecipe(
  base: RecipeRecord,
  servings: number,
  substitutions: IngredientSubstitution[],
  title?: string,
  summary?: string,
): RecipeRecord {
  const ratio = servings / base.servings;
  const replacementMap = new Map(substitutions.map((item) => [item.fromIngredientId, item]));
  const ingredients: RecipeIngredient[] = base.ingredients.map((ingredient) => {
    const replacement = replacementMap.get(ingredient.id);
    return {
      ...ingredient,
      ...(replacement ? { id: replacement.toIngredientId, name: replacement.toLabel } : {}),
      quantity: Math.round(ingredient.quantity * ratio * 1000000) / 1000000,
    };
  });
  const result: RecipeRecord = {
    ...base,
    id: `custom-${randomUUID()}`,
    title: title?.trim().slice(0, 120) || (substitutions.length > 0 ? `${base.title}, adjusted` : `${base.title}, custom amount`),
    summary: summary?.trim().slice(0, 300) || `A catalogue-grounded version of ${base.title}.`,
    servings,
    ingredients,
    dietary_tags: substitutions.length === 0 ? [...base.dietary_tags] : base.dietary_tags.filter((tag) =>
      ingredients.every((ingredient) => getIngredient(ingredient.id)?.dietaryTags.includes(tag))),
    source: `haleview-custom:${base.id}`,
    preparation: base.preparation.map((step) => ({
      ...step,
      description: replaceText(step.description, substitutions),
      ingredients: step.ingredients.map((value) => replacementMap.get(value)?.toIngredientId ?? replaceText(value, substitutions)),
    })),
  };
  // Classify composition at the canonical recipe amount. Requested portions affect
  // display totals, not dietary eligibility. Use original quantities directly to
  // avoid scaling and rounding changing classifications near a threshold.
  const nutrition = nutritionFor({
    ...result,
    ingredients: ingredients.map((ingredient, index) => ({
      ...ingredient, quantity: base.ingredients[index].quantity,
    })),
  });
  result.dietary_tags = result.dietary_tags.filter((tag) => !nutritionTags.has(tag));
  if (nutrition.proteinG >= 20) result.dietary_tags.push("high_protein");
  if (nutrition.fatsG <= 15) result.dietary_tags.push("low_fat");
  if (nutrition.sodiumMg <= 600) result.dietary_tags.push("low_sodium");
  return result;
}

function nutritionFor(recipe: RecipeRecord): NutritionValues {
  if (recipe.ingredients.length > 20) throw new NutritionGenerationError("invalid_parameters", "A custom recipe has too many ingredients.", 400, false);
  const result = executeNutritionFunction({
    name: "calculate_ingredient_list_nutrition",
    arguments: {
      ingredients: recipe.ingredients.map(({ id, quantity, unit }) => ({ id, quantity, unit })),
    },
  });
  return result.value.nutrition as unknown as NutritionValues;
}

export async function generateCustomRecipe(
  request: CustomRecipeRequest,
  options: CustomRecipeOptions,
): Promise<CustomRecipeResult> {
  const query = cleanQuery(request.query);
  const searchQuery = [...new Set([query, ...options.preferences.cuisinePreferences, ...dietaryStylePreferences(options.preferences.dietaryPreferences)])].join(" ").slice(0, 160);
  const retrieval = buildRecipeRetrievalContext(searchQuery, {
    dietaryTags: generationTags(options.preferences),
    allergies: options.preferences.allergies,
    excludedIngredients: options.preferences.dislikedIngredients,
    limit: 8,
  }, { userId: options.userId });
  const base = request.baseRecipeId ? getRecipe(request.baseRecipeId) : retrieval.retrievedRecipes[0]?.recipe;
  if (!base) throw new CustomRecipeError("No catalogue recipe matches this request and the saved restrictions.", 404);
  const requested = request.substitutions;
  let substitutions = validatedSubstitutions(base, requested ?? [], options.preferences);
  const servings = cleanServings(request.servings, base.servings);
  let title: string | undefined;
  let summary: string | undefined;
  let source: "local" | "deepseek" = "local";
  let model: string | null = null;
  const candidateSubstitutions = base.ingredients.flatMap((ingredient) => alternativeRecords(base, ingredient.id, options.preferences));
  if (options.provider) {
    try {
      const completion = await options.provider.complete(buildRecipePrompt("recipe_variation", {
        request: query, baseRecipe: base, selectedRecipeId: base.id,
        servings, requestedSubstitutions: requested ?? null,
        allowedSubstitutions: candidateSubstitutions,
        preferences: options.preferences,
        availability: "Only supplied catalogue ingredients are available; pantry stock is unknown.",
      }));
      const output = completion.content;
      if (output.recipeId !== base.id || !Array.isArray(output.substitutions)
        || typeof output.title !== "string" || !output.title.trim() || output.title.length > 120
        || typeof output.summary !== "string" || !output.summary.trim() || output.summary.length > 300) {
        throw new CustomRecipeError("The provider did not return a valid recipe variation.");
      }
      const proposed = validatedSubstitutions(base, output.substitutions, options.preferences);
      if (requested !== undefined && (proposed.length !== substitutions.length || proposed.some((item) =>
        !substitutions.some((saved) => saved.fromIngredientId === item.fromIngredientId && saved.toIngredientId === item.toIngredientId)))) {
        throw new CustomRecipeError("The provider changed an explicitly requested substitution.");
      }
      if (proposed.length === 0 && servings === base.servings) throw new CustomRecipeError("The provider did not change the recipe.");
      // Validate before accepting any provider fields, so a fallback cannot retain partial output.
      assertRestrictions(customRecipe(base, servings, proposed), options.preferences);
      substitutions = proposed;
      title = output.title;
      summary = output.summary;
      source = "deepseek";
      model = completion.model;
    } catch {
      source = "local";
      model = null;
    }
  }
  if (substitutions.length === 0 && requested === undefined) {
    const choices = candidateSubstitutions.filter((choice) => recipeMeetsFoodRestrictions(customRecipe(base, servings, [choice]), restrictions(options.preferences)));
    if (choices.length > 0) {
      const seed = Number.parseInt(createHash("sha256").update(query).digest("hex").slice(0, 8), 16);
      substitutions = [choices[seed % choices.length]];
    }
  }
  if (substitutions.length === 0 && servings === base.servings) {
    throw new CustomRecipeError("No ingredient or amount change is possible with the requested substitutions and saved restrictions.", 422);
  }
  const recipe = customRecipe(base, servings, substitutions, title, summary);
  assertRestrictions(recipe, options.preferences);
  return resultFor(recipe, substitutions, options, source, model, [...new Set([base.id, ...retrieval.retrievedRecipes.map((item) => item.recipe.id)])]);
}

function restrictions(preferences: NutritionPreferences) {
  return { dietaryTags: generationTags(preferences), allergies: preferences.allergies, excludedIngredients: preferences.dislikedIngredients };
}

function assertRestrictions(recipe: RecipeRecord, preferences: NutritionPreferences): void {
  if (!recipeMeetsFoodRestrictions(recipe, restrictions(preferences))) {
    throw new CustomRecipeError("This recipe does not meet the saved food restrictions.");
  }
}

function resultFor(recipe: RecipeRecord, substitutions: IngredientSubstitution[], options: CustomRecipeOptions,
  source: "local" | "deepseek", model: string | null, baseRecipeIds: string[]): CustomRecipeResult {
  const nutrition = nutritionFor(recipe);
  return {
    recipe, nutrition, enhancedNutrition: getRecipeEnhancedNutrition(recipe, nutrition), source, model,
    baseRecipeIds, substitutions, nutritionFunction: "calculate_ingredient_list_nutrition",
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
  };
}

export function scaleCustomRecipe(
  input: { baseRecipeId: string; substitutions: CustomRecipeSubstitutionInput[]; servings: number },
  options: CustomRecipeOptions,
): CustomRecipeResult {
  const base = getRecipe(input.baseRecipeId);
  if (!base) throw new CustomRecipeError("Recipe not found.", 404);
  if (input.servings === undefined) throw new CustomRecipeError("Recipe amount is required.");
  const servings = cleanServings(input.servings, base.servings);
  const substitutions = validatedSubstitutions(base, input.substitutions, options.preferences);
  const recipe = customRecipe(base, servings, substitutions);
  assertRestrictions(recipe, options.preferences);
  return resultFor(recipe, substitutions, options, "local", null, [base.id]);
}
