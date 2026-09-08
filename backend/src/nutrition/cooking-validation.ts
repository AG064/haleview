import type { IngredientRecord, RecipeRecord } from "./types.js";

type MeasurementState = "dry" | "raw" | "cooked" | "as listed";

export function ingredientMeasurementState(ingredient: Pick<IngredientRecord, "id" | "label">): MeasurementState {
  // This archive label omits the dry state of its 100 g nutrition record.
  if (ingredient.id === "ingredient-000103") return "dry";
  if (/\b(?:cooked|roasted|grilled|boiled|braised|stewed)\b/iu.test(ingredient.label)) return "cooked";
  if (/\b(?:dry|dried|uncooked)\b/iu.test(ingredient.label)) return "dry";
  if (/\braw\b/iu.test(ingredient.label)) return "raw";
  return "as listed";
}

function requestedRiceState(request: string): "cooked" | "dry" | undefined {
  const match = /\b(?:use|using|with|add|from)\s+(?:already\s+)?(cooked|dry|raw|uncooked)\s+(?:(?:white|brown|long[- ]grain|short[- ]grain)\s+)?rice\b/iu.exec(request);
  if (match) return match[1].toLowerCase() === "cooked" ? "cooked" : "dry";
  return /\b(?:leftover|pre[- ]?cooked)\s+rice\b/iu.test(request) ? "cooked" : undefined;
}

export function matchesRequestedCookingState(ingredient: IngredientRecord, request: string): boolean {
  const state = requestedRiceState(request);
  if (!state || !/\brice\b/iu.test(ingredient.label)) return true;
  return ingredientMeasurementState(ingredient) === state;
}

export function recipeCookingWarning(recipe: RecipeRecord, request = ""): string | undefined {
  if (recipe.source !== "haleview-created") return undefined;
  const rice = recipe.ingredients.filter(item => /\brice\b/iu.test(item.name));
  const riceState = (item: RecipeRecord["ingredients"][number]) => ingredientMeasurementState({id: item.id, label: item.name});
  const requested = requestedRiceState(request);
  if (requested && rice.some(item => riceState(item) !== requested)) {
    return `Use a ${requested}-rice catalogue record for the requested quantity. Dry and cooked rice weights are not interchangeable.`;
  }
  const dryRice = new Set(rice.filter(item => ["dry", "raw"].includes(riceState(item))).map(item => item.id));
  const cookedRice = rice.some(item => riceState(item) === "cooked");
  let ricePrepared = false;
  let seasonedCookingLiquid = false;
  const seasoningIds = new Set(recipe.ingredients.filter(item => /\b(?:salt|milk|broth|stock|butter|oil)\b/iu.test(item.name)).map(item => item.id));
  for (const step of recipe.preparation) {
    const text = step.description.toLowerCase();
    if (dryRice.size > 0 && !cookedRice && !ricePrepared && /\b(?:cooked|leftover|pre[- ]?cooked)\s+(?:(?:white|brown|long[- ]grain|short[- ]grain)\s+)?rice\b/iu.test(text)) {
      return "The preparation starts with cooked rice but its quantities use a dry-rice record. Recreate this recipe with a cooked-rice record or an explicit step that cooks the measured dry rice first.";
    }
    if (dryRice.size > 0 && step.ingredients.some(id => dryRice.has(id)) && /\b(?:cook|boil|simmer|steam)\b/iu.test(text)) ricePrepared = true;
    if (/\b(?:salted|seasoned)\s+(?:(?:boiling|cooking)\s+)?water\b/iu.test(text)
      || (/\b(?:boil|parboil|blanch|simmer)\b/iu.test(text) && step.ingredients.some(id => seasoningIds.has(id)))) {
      seasonedCookingLiquid = true;
    }
    const actions = text.replace(/\b(?:do not|don't|never)\s+(?:drain|discard|strain|pour\s+(?:off|away))\b/giu, "");
    const drains = /\b(?:drain|discard|strain|pour\s+(?:off|away))\b/iu.test(actions);
    if (drains && (seasonedCookingLiquid || /\b(?:drain|discard|strain|pour\s+(?:off|away))\b[^.;]{0,45}\b(?:oil|fat|butter|milk|broth|stock|marinade|sauce|cooking\s+liquid)\b/iu.test(actions))) {
      return "The consumed amount of discarded cooking liquid or fat is unknown. Use a no-drain method, or plain unsalted water and add the measured seasoning only after draining. Do not estimate how much salt or fat remains.";
    }
  }
  return undefined;
}
