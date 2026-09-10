import type { NutritionValues } from "./types.js";

export type MicronutrientKey = "fiberG" | "sodiumMg" | "vitaminDMcg" | "vitaminB12Mcg" | "ironMg" | "calciumMg" | "magnesiumMg";

export interface MicronutrientReference {
  key: MicronutrientKey;
  label: string;
  target: number;
  unit: "g" | "mg" | "mcg";
  kind: "minimum" | "maximum";
}

export const micronutrientReferences: readonly MicronutrientReference[] = [
  { key: "fiberG", label: "Fibre", target: 28, unit: "g", kind: "minimum" },
  { key: "sodiumMg", label: "Sodium", target: 2300, unit: "mg", kind: "maximum" },
  { key: "vitaminDMcg", label: "Vitamin D", target: 20, unit: "mcg", kind: "minimum" },
  { key: "vitaminB12Mcg", label: "Vitamin B12", target: 2.4, unit: "mcg", kind: "minimum" },
  { key: "ironMg", label: "Iron", target: 18, unit: "mg", kind: "minimum" },
  { key: "calciumMg", label: "Calcium", target: 1300, unit: "mg", kind: "minimum" },
  { key: "magnesiumMg", label: "Magnesium", target: 420, unit: "mg", kind: "minimum" },
];

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function enhancedNutritionProfile(nutrition: NutritionValues, ingredientIds: string[]): {
  nutrientDensityScore: number;
  satietyIndex: number;
  ingredientDiversity: number;
  calculationBasis: "catalogue_nutrients";
} {
  const energyFactor = nutrition.caloriesKcal > 0 ? 1000 / nutrition.caloriesKcal : 0;
  const densityValues = micronutrientReferences
    .filter((item) => item.kind === "minimum")
    .map((item) => Math.min(1.5, nutrition[item.key] * energyFactor / item.target));
  const density = densityValues.length > 0
    ? densityValues.reduce((total, value) => total + value, 0) / densityValues.length
    : 0;
  const proteinPart = Math.min(1, nutrition.proteinG * energyFactor / 75);
  const fiberPart = Math.min(1, nutrition.fiberG * energyFactor / 28);
  return {
    nutrientDensityScore: round(Math.min(10, density / 1.5 * 10)),
    satietyIndex: Math.round((proteinPart * 0.55 + fiberPart * 0.45) * 100),
    ingredientDiversity: new Set(ingredientIds).size,
    calculationBasis: "catalogue_nutrients",
  };
}
