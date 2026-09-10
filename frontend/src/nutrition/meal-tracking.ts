import type { MealPlan, NutritionIntakeRecord, PlannedMeal } from "./types";

export function mealsForDate(plans: MealPlan[], date: string): { plan: MealPlan | null; meals: PlannedMeal[] } {
  const plan = plans.find((value) => value.days.some((day) => day.date === date)) ?? null;
  const meals = [...(plan?.days.find((day) => day.date === date)?.meals ?? [])]
    .sort((left, right) => left.time.localeCompare(right.time) || left.order - right.order);
  return { plan, meals };
}

export function loggedMealIds(records: NutritionIntakeRecord[], date: string): Set<string> {
  return new Set(records.filter((record) => record.date === date).flatMap((record) => (
    record.entries.flatMap((entry) => entry.source === "plan" && entry.sourceId ? [entry.sourceId] : [])
  )));
}
