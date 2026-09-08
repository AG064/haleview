import {after, test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {cleanup, preferences, profileInput} from "./environment.mjs";

const catalog = await import("../dist/nutrition/catalog.js");
const {executeNutritionFunction} = await import("../dist/nutrition/function-calling.js");
const {dietaryPreferenceValues, allergyValues, deriveNutritionDefaults, parseNutritionPreferences} = await import("../dist/nutrition/preferences.js");
const {buildProfile, activityLevels} = await import("../dist/profile.js");
const {embedText, cosineSimilarity} = await import("../dist/nutrition/embeddings.js");
const {buildRecipeRetrievalContext} = await import("../dist/nutrition/rag.js");
const {generateMealPlan, moveMeal, addManualMeal, emptyNutrition} = await import("../dist/nutrition/meal-plans.js");
const {createShoppingList, updateShoppingListItem, foodGroupForCategory} = await import("../dist/nutrition/shopping-list.js");
const {saveMealPlan, getMealPlanVersions, restoreMealPlanVersion} = await import("../dist/nutrition/meal-plan-storage.js");
const {recipeCookingWarning} = await import("../dist/nutrition/cooking-validation.js");
after(cleanup);

test("catalogues contain complete records in standard units", async () => {
  const ingredients = catalog.getCatalogIngredients();
  const recipes = JSON.parse(await readFile(new URL("../dist/nutrition/data/recipes.json", import.meta.url), "utf8"));
  assert.ok(ingredients.length >= 500 && recipes.length >= 500);
  const ids = new Set(ingredients.map(item => item.id));
  for (const ingredient of ingredients) {
    assert.ok(["g", "ml"].includes(ingredient.unit));
    assert.ok(ingredient.quantity > 0 && ingredient.label);
    for (const key of ["calories", "carbs", "protein", "fats"]) assert.ok(Number.isFinite(ingredient.nutrition[key]) && ingredient.nutrition[key] >= 0);
  }
  for (const recipe of recipes) {
    for (const key of ["id", "title", "cuisine", "meal", "servings", "ingredients", "summary", "time", "difficulty_level", "dietary_tags", "source", "img", "preparation"]) assert.ok(key in recipe, `${recipe.id}: ${key}`);
    assert.ok(recipe.ingredients.every(item => ids.has(item.id) && item.name && item.quantity > 0));
    assert.ok(recipe.preparation.every(step => step.step > 0 && step.description && Array.isArray(step.ingredients)));
  }
});

test("nutrition preferences reuse health data and validate their limits", () => {
  assert.ok(dietaryPreferenceValues.length >= 15 && allergyValues.length >= 10);
  const profile = buildProfile(profileInput);
  const defaults = deriveNutritionDefaults(profile);
  assert.deepEqual(defaults.dietaryPreferences, profileInput.dietaryPreferences);
  assert.ok(defaults.allergies.includes("peanuts"));
  const active = deriveNutritionDefaults(buildProfile({...profileInput, activityLevel: activityLevels.at(-1)}));
  const sedentary = deriveNutritionDefaults(buildProfile({...profileInput, activityLevel: activityLevels[0]}));
  assert.ok(active.calorieTargetKcal > sedentary.calorieTargetKcal);
  assert.throws(() => parseNutritionPreferences({...preferences, mealsPerDay: 0}));
  assert.throws(() => parseNutritionPreferences({...preferences, allergies: ["unknown-allergy"]}));
  assert.throws(() => parseNutritionPreferences({...preferences, mealTimes: ["25:00"]}));
});

test("recipe and ingredient retrieval use stable vectors with relevant matches", () => {
  const vector = embedText("cooked brown rice");
  assert.equal(vector.length, 48);
  assert.ok(Math.abs(cosineSimilarity(vector, vector) - 1) < 0.000001);
  assert.equal(cosineSimilarity([], vector), 0);
  assert.match(catalog.searchIngredients("cooked brown rice", 1)[0].label, /brown rice, cooked/i);
  assert.deepEqual(catalog.searchIngredients("unavailablefoodxyz"), []);
  const context = buildRecipeRetrievalContext("tomato", {dietaryTags: ["vegan"], allergies: ["peanuts"]});
  assert.ok(context.retrievedRecipes.length > 0);
  for (const item of context.retrievedRecipes) {
    assert.ok(context.augmentedPrompt.includes(item.recipe.id));
    assert.ok(catalog.recipeMeetsFoodRestrictions(item.recipe, {dietaryTags: ["vegan"], allergies: ["peanuts"]}));
  }
});

test("function calls calculate ingredient amounts and scale every recipe quantity", () => {
  const ingredient = catalog.getIngredient("ingredient-000558");
  const result = executeNutritionFunction({name: "calculate_ingredient_list_nutrition", arguments: {ingredients: [{id: ingredient.id, quantity: 25, unit: "g"}]}});
  assert.equal(result.source, "backend_function");
  assert.equal(result.value.nutrition.caloriesKcal, ingredient.nutrition.caloriesKcal / 4);
  const recipe = catalog.getRecipe("recipe-000523");
  const scaled = executeNutritionFunction({name: "scale_recipe", arguments: {recipeId: recipe.id, servings: 2}}).value;
  assert.ok(scaled.recipe.ingredients.every((item, index) => item.quantity === recipe.ingredients[index].quantity * 2));
  assert.equal(scaled.nutrition.caloriesKcal, catalog.getRecipeNutrition(recipe).caloriesKcal * 2);
});

test("function calls reject malformed, missing, unknown and invalid inputs", () => {
  for (const call of [
    {name: "unknown", arguments: {}},
    {name: "scale_recipe", arguments: "{"},
    {name: "scale_recipe", arguments: {recipeId: "recipe-000523"}},
    {name: "scale_recipe", arguments: {recipeId: "recipe-000523", servings: -1}},
    {name: "calculate_ingredient_list_nutrition", arguments: {ingredients: [{id: "missing", quantity: 1, unit: "g"}]}},
  ]) assert.throws(() => executeNutritionFunction(call), error => typeof error.code === "string" && Number.isInteger(error.status));
});

let cachedWeek;
const makePlan = duration => generateMealPlan({duration, startDate: "2026-01-01", preferences, health: {bmi: 24, activityLevel: "moderate", fitnessGoal: "general_fitness"}});
const getWeek = () => cachedWeek ??= makePlan("week");
test("local daily and weekly plans respect the saved meal structure and targets", async () => {
  for (const duration of ["day", "week"]) {
    const plan = duration === "week" ? await getWeek() : await makePlan("day");
    assert.equal(plan.days.length, duration === "week" ? 7 : 1);
    for (const day of plan.days) {
      assert.equal(day.meals.length, preferences.mealsPerDay + preferences.snacksPerDay);
      assert.ok(Math.abs(day.nutrition.caloriesKcal / preferences.calorieTargetKcal - 1) <= 0.1);
      for (const meal of day.meals) {
        assert.ok(meal.title && meal.mealType && meal.nutrition.caloriesKcal > 0);
        assert.match(meal.scheduledAt, /^\d{4}-\d{2}-\d{2}T/);
        assert.ok(catalog.recipeMeetsFoodRestrictions(catalog.getRecipe(meal.recipeId), {dietaryTags: ["vegetarian"], allergies: ["peanuts"]}));
      }
    }
  }
});

test("moving meals, manual additions and version restore preserve the original plan", async () => {
  const week = await getWeek();
  const meal = week.days[0].meals[0];
  const moved = moveMeal(week, meal.id, week.days[1].date, "lunch", "13:15");
  assert.equal(week.days[0].meals.length, 4);
  assert.ok(Math.abs(meal.targetPercentages.protein - meal.nutrition.proteinG / preferences.macroTargets.proteinG * 100) < 0.00001);
  assert.ok(Math.abs(moved.days[1].targetPercentages.protein - moved.days[1].nutrition.proteinG / preferences.macroTargets.proteinG * 100) < 0.00001);
  assert.equal(moved.days[0].meals.length, 3);
  assert.equal(moved.days[1].meals.find(item => item.id === meal.id).mealType, "lunch");
  const custom = addManualMeal(moved, {date: week.startDate, time: "16:00", mealType: "snack", title: "Homemade snack", nutrition: {...emptyNutrition(), caloriesKcal: 150, proteinG: 10}});
  assert.ok(custom.days[0].meals.some(item => item.manual && item.nutrition.caloriesKcal === 150));
  saveMealPlan(1, week, "Original plan");
  saveMealPlan(1, custom, "Changed plan");
  const versions = getMealPlanVersions(1, week.id);
  assert.equal(versions.length, 2);
  const restored = restoreMealPlanVersion(1, week.id, versions.find(item => item.version === 1).id);
  assert.equal(restored.nutrition.caloriesKcal, week.nutrition.caloriesKcal);
  assert.deepEqual(getMealPlanVersions(2, week.id), []);
});

test("shopping lists support a single meal, meaningful groups, changes and exclusions", async () => {
  const week = await getWeek();
  const list = createShoppingList(week, {mealId: week.days[0].meals[0].id});
  assert.ok(list.items.length > 0);
  assert.equal(foodGroupForCategory("dairy"), "Dairy");
  assert.ok(new Set(["dairy", "vegetables", "grains", "meat", "spices", "drinks", "other"].map(foodGroupForCategory)).size >= 5);
  const item = list.items[0];
  const changed = updateShoppingListItem(list, item.id, {quantity: item.quantity * 2, checked: true});
  assert.equal(changed.items[0].quantity, item.quantity * 2);
  assert.equal(changed.items[0].checked, true);
  assert.equal(list.items[0].quantity, item.quantity);
  assert.ok(!updateShoppingListItem(changed, item.id, {removed: true}).items.some(value => value.id === item.id));
});

test("cooking-state and retained-quantity guards distinguish unsafe and valid methods", () => {
  const rice = {source: "haleview-created", ingredients: [{id: "ingredient-000103", name: "White long-grain rice", quantity: 200, unit: "g"}], preparation: [{description: "Combine cooked rice with the milk.", ingredients: ["ingredient-000103"]}]};
  assert.match(recipeCookingWarning(rice), /dry-rice/);
  const cooked = {...rice, ingredients: [{id: "ingredient-000557", name: "Brown rice, cooked", quantity: 200, unit: "g"}]};
  assert.equal(recipeCookingWarning(cooked), undefined);
  const salt = {source: "haleview-created", ingredients: [{id: "salt", name: "Table salt", quantity: 2, unit: "g"}], preparation: [{description: "Boil potatoes in salted water, then drain.", ingredients: ["salt"]}]};
  assert.match(recipeCookingWarning(salt), /consumed amount/);
  salt.preparation = [{description: "Boil potatoes in plain unsalted water, then drain.", ingredients: []}, {description: "Add the measured salt after draining.", ingredients: ["salt"]}];
  assert.equal(recipeCookingWarning(salt), undefined);
});
