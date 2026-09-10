import type { NutritionUnit } from "./types.js";

export const nutritionUnits = ["g", "ml"] as const;

export class NutritionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NutritionValidationError";
  }
}

export function parseQuantity(input: unknown): { quantity: number; unit: NutritionUnit } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new NutritionValidationError("Quantity must include a number and a standard unit.");
  }
  const value = input as Record<string, unknown>;
  const quantity = value.quantity;
  const unit = value.unit;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) {
    throw new NutritionValidationError("Quantity must be greater than zero and no more than 100000.");
  }
  if (typeof unit !== "string" || !nutritionUnits.includes(unit as NutritionUnit)) {
    throw new NutritionValidationError("Unit must be g for solids or ml for liquids.");
  }
  return { quantity, unit: unit as NutritionUnit };
}

export function assertIsoDateTime(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    throw new NutritionValidationError("Time must use an ISO 8601 UTC date and time.");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new NutritionValidationError("Time must be a real ISO 8601 UTC date and time.");
  }
  return value;
}

export function assertIsoDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new NutritionValidationError("Date must use the ISO 8601 date format.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new NutritionValidationError("Date must be a real ISO 8601 date.");
  }
  return value;
}

export function assertMealTime(value: unknown): string {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(value)) {
    throw new NutritionValidationError("Meal time must use HH:mm.");
  }
  return value;
}

export function assertStandardUnit(value: unknown): NutritionUnit {
  if (typeof value !== "string" || !nutritionUnits.includes(value as NutritionUnit)) {
    throw new NutritionValidationError("Unit must be g for solids or ml for liquids.");
  }
  return value as NutritionUnit;
}
