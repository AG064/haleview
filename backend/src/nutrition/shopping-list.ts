import { randomUUID } from "node:crypto";
import { database } from "../storage.js";
import { protectStoredText, unprotectStoredText } from "../protected-data.js";
import { getIngredient, getRecipe } from "./catalog.js";
import type { MealPlan, PlannedMeal } from "./meal-plans.js";
import type { NutritionUnit } from "./types.js";

export type FoodGroup =
  | "Produce"
  | "Protein"
  | "Dairy"
  | "Grains"
  | "Pantry"
  | "Drinks"
  | "Other";

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

export interface ShoppingListOptions {
  id?: string;
  createdAt?: string;
  mealId?: string;
}

export class ShoppingListValidationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = "ShoppingListValidationError";
  }
}

const groupOrder: FoodGroup[] = [
  "Produce",
  "Protein",
  "Dairy",
  "Grains",
  "Pantry",
  "Drinks",
  "Other",
];

function round(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function validQuantity(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1000000) {
    throw new ShoppingListValidationError(
      "Quantity must be greater than zero and at most one million.",
    );
  }
  return round(value);
}

export function foodGroupForCategory(category: string): FoodGroup {
  const value = category.toLowerCase();
  if (/fruit|vegetable|produce|herb/u.test(value)) return "Produce";
  if (/meat|poultry|fish|seafood|egg|legume|bean|protein/u.test(value))
    return "Protein";
  if (/dairy|milk|cheese|yogurt/u.test(value)) return "Dairy";
  if (/grain|flour|cereal|pasta|bread|rice/u.test(value)) return "Grains";
  if (/beverage|drink|juice/u.test(value)) return "Drinks";
  if (/pantry|spice|season|sweet|leaven|sauce|oil|fat|condiment/u.test(value))
    return "Pantry";
  return "Other";
}

function selectedMeals(plan: MealPlan, mealId?: string): PlannedMeal[] {
  if (!mealId) return plan.days.flatMap((day) => day.meals);
  const meal = plan.days
    .flatMap((day) => day.meals)
    .find((item) => item.id === mealId);
  if (!meal)
    throw new ShoppingListValidationError("The selected meal was not found.");
  return [meal];
}

function itemSort(first: ShoppingItem, second: ShoppingItem): number {
  return (
    groupOrder.indexOf(first.group) - groupOrder.indexOf(second.group) ||
    first.name.localeCompare(second.name)
  );
}

export function createShoppingList(
  plan: MealPlan,
  options: ShoppingListOptions = {},
): ShoppingList {
  const meals = selectedMeals(plan, options.mealId);
  const grouped = new Map<string, ShoppingItem>();
  for (const meal of meals) {
    if (!meal.recipeId) continue;
    const recipe = meal.recipeSnapshot ?? getRecipe(meal.recipeId);
    if (!recipe)
      throw new ShoppingListValidationError(
        "A planned recipe is not available in the catalogue.",
      );
    const ratio = meal.servings / recipe.servings;
    for (const recipeIngredient of recipe.ingredients) {
      const ingredient = getIngredient(recipeIngredient.id);
      if (!ingredient)
        throw new ShoppingListValidationError(
          "A planned ingredient is not available in the catalogue.",
        );
      const key = `${ingredient.id}:${recipeIngredient.unit}`;
      const current = grouped.get(key);
      const quantity = recipeIngredient.quantity * ratio;
      if (current) {
        current.quantity = round(current.quantity + quantity);
      } else {
        grouped.set(key, {
          id: "",
          ingredientId: ingredient.id,
          name: ingredient.label,
          quantity: round(quantity),
          unit: recipeIngredient.unit,
          group: foodGroupForCategory(ingredient.category),
        });
      }
    }
  }

  const items = [...grouped.values()].sort(itemSort).map((item, index) => ({
    ...item,
    id: `shopping-item-${index + 1}`,
  }));
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new ShoppingListValidationError(
      "List date must be a valid ISO timestamp.",
    );
  }
  return {
    id: options.id ?? `shopping-${randomUUID()}`,
    planId: plan.id,
    sourceType: options.mealId ? "meal" : "plan",
    sourceId: options.mealId ?? plan.id,
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: new Date(createdAt).toISOString(),
    items,
  };
}

export function updateShoppingListItem(
  list: ShoppingList,
  itemId: string,
  change: { quantity?: number; removed?: boolean; checked?: boolean },
): ShoppingList {
  const index = list.items.findIndex((item) => item.id === itemId);
  if (index < 0)
    throw new ShoppingListValidationError("The shopping item was not found.");
  if (change.removed === true) {
    return { ...list, items: list.items.filter((item) => item.id !== itemId) };
  }
  if (change.checked !== undefined && typeof change.checked !== "boolean")
    throw new ShoppingListValidationError("Checked must be true or false.");
  const quantity =
    change.quantity === undefined ? undefined : validQuantity(change.quantity);
  return {
    ...list,
    items: list.items.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            ...(quantity === undefined ? {} : { quantity }),
            ...(change.checked === undefined
              ? {}
              : { checked: change.checked }),
          }
        : { ...item },
    ),
  };
}

function userIdValue(userId: number): number {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new ShoppingListValidationError("A signed-in account is required.");
  }
  return userId;
}

function readList(value: string): ShoppingList {
  const parsed = JSON.parse(
    unprotectStoredText(value),
  ) as Partial<ShoppingList>;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.id !== "string" ||
    !Array.isArray(parsed.items)
  ) {
    throw new ShoppingListValidationError(
      "The saved shopping list is not valid.",
    );
  }
  return parsed as ShoppingList;
}

database.exec(`
  CREATE TABLE IF NOT EXISTS shopping_lists (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    plan_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    list_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS shopping_lists_user_updated ON shopping_lists(user_id, updated_at);
`);

export function getShoppingList(
  userId: number,
  listId: string,
): ShoppingList | null {
  const row = database
    .prepare(
      "SELECT list_json FROM shopping_lists WHERE user_id = ? AND id = ?",
    )
    .get(userIdValue(userId), listId) as { list_json?: string } | undefined;
  return row?.list_json ? readList(row.list_json) : null;
}

export function listShoppingLists(
  userId: number,
  planId?: string,
): ShoppingList[] {
  const rows = planId
    ? database
        .prepare(
          "SELECT list_json FROM shopping_lists WHERE user_id = ? AND plan_id = ? ORDER BY rowid DESC LIMIT 20",
        )
        .all(userIdValue(userId), planId)
    : database
        .prepare(
          "SELECT list_json FROM shopping_lists WHERE user_id = ? ORDER BY rowid DESC LIMIT 20",
        )
        .all(userIdValue(userId));
  return (rows as Array<{ list_json: string }>).map((row) =>
    readList(row.list_json),
  );
}

export function saveShoppingList(
  userId: number,
  list: ShoppingList,
): ShoppingList {
  const safeUserId = userIdValue(userId);
  const existing = getShoppingList(safeUserId, list.id);
  const otherOwner = database
    .prepare("SELECT user_id FROM shopping_lists WHERE id = ?")
    .get(list.id) as { user_id: number } | undefined;
  if (otherOwner && otherOwner.user_id !== safeUserId) {
    throw new ShoppingListValidationError(
      "The shopping list could not be saved.",
      409,
    );
  }
  const updatedAt = new Date();
  const previousTime = existing ? Date.parse(existing.updatedAt) : NaN;
  if (Number.isFinite(previousTime) && updatedAt.getTime() <= previousTime)
    updatedAt.setTime(previousTime + 1);
  const saved = { ...list, updatedAt: updatedAt.toISOString() };
  database
    .prepare(
      "INSERT INTO shopping_lists (id, user_id, plan_id, source_type, source_id, list_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET plan_id = excluded.plan_id, source_type = excluded.source_type, source_id = excluded.source_id, list_json = excluded.list_json, created_at = excluded.created_at, updated_at = excluded.updated_at WHERE shopping_lists.user_id = excluded.user_id",
    )
    .run(
      saved.id,
      safeUserId,
      saved.planId,
      saved.sourceType,
      saved.sourceId,
      protectStoredText(JSON.stringify(saved)),
      protectStoredText(saved.createdAt),
      protectStoredText(saved.updatedAt),
    );
  return saved;
}
