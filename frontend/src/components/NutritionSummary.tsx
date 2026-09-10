import { useState } from "react";
import type { EnhancedNutritionProfile, NutritionValues } from "../nutrition/types";

interface NutritionSummaryProps {
  nutrition: NutritionValues;
  label?: string;
  enhanced?: EnhancedNutritionProfile;
}

export function NutritionSummary({ nutrition, label = "Nutrition per serving", enhanced }: NutritionSummaryProps) {
  return (
    <div className="nutrition-summary" aria-label={label}>
      <div className="nutrition-primary">
      <div className="nutrition-energy-block">
        <div className="nutrition-calories"><span className="metric-label">Energy</span><strong>{Math.round(nutrition.caloriesKcal)} kcal</strong></div>
        <div className="nutrition-fibre"><span className="metric-label">Fibre</span><strong>{Math.round(nutrition.fiberG)} g</strong></div>
      </div>
      <MacroBreakdown nutrition={nutrition} label={`${label} macro breakdown`} showAmounts />
      </div>
      <details className="nutrition-micronutrients" open>
        <summary>More nutrition</summary>
        <dl>
          <div><dt>Sugar</dt><dd>{Math.round(nutrition.sugarG)} g</dd></div>
          <div><dt>Sodium</dt><dd>{Math.round(nutrition.sodiumMg)} mg</dd></div>
          <div><dt>Vitamin D</dt><dd>{Math.round(nutrition.vitaminDMcg)} mcg</dd></div>
          <div><dt>Vitamin B12</dt><dd>{Math.round(nutrition.vitaminB12Mcg * 10) / 10} mcg</dd></div>
          <div><dt>Iron</dt><dd>{Math.round(nutrition.ironMg * 10) / 10} mg</dd></div>
          <div><dt>Calcium</dt><dd>{Math.round(nutrition.calciumMg)} mg</dd></div>
          <div><dt>Magnesium</dt><dd>{Math.round(nutrition.magnesiumMg)} mg</dd></div>
        </dl>
        {enhanced && <div className="enhanced-nutrition-profile"><p>Calculated from catalogue nutrients</p><dl><div><dt>Nutrient density</dt><dd>{enhanced.nutrientDensityScore} / 10</dd></div><div><dt>Satiety index</dt><dd>{enhanced.satietyIndex} / 100</dd></div><div><dt>Ingredient diversity</dt><dd>{enhanced.ingredientDiversity}</dd></div></dl></div>}
      </details>
    </div>
  );
}

export function MacroBreakdown({ nutrition, label = "Macro breakdown", showAmounts = false }: { nutrition: NutritionValues; label?: string; showAmounts?: boolean }) {
  const proteinCalories = nutrition.proteinG * 4;
  const carbohydrateCalories = nutrition.carbsG * 4;
  const fatCalories = nutrition.fatsG * 9;
  const total = proteinCalories + carbohydrateCalories + fatCalories;
  const protein = total > 0 ? proteinCalories / total * 100 : 0;
  const carbohydrate = total > 0 ? carbohydrateCalories / total * 100 : 0;
  const fat = total > 0 ? Math.max(0, 100 - protein - carbohydrate) : 0;
  const chartBackground = total > 0
    ? `conic-gradient(var(--accent) 0 ${protein}%, var(--chart-carbs) ${protein}% ${protein + carbohydrate}%, var(--chart-fat) ${protein + carbohydrate}% 100%)`
    : "var(--line)";
  const macros = [
    { key: "protein", label: "Protein", percent: protein, grams: nutrition.proteinG, className: "key-protein" },
    { key: "carbohydrate", label: "Carbohydrate", percent: carbohydrate, grams: nutrition.carbsG, className: "key-carbs" },
    { key: "fat", label: "Fat", percent: fat, grams: nutrition.fatsG, className: "key-fat" }
  ] as const;
  const [selectedMacro, setSelectedMacro] = useState<(typeof macros)[number]["key"]>("protein");
  const selectedIndex = macros.findIndex((macro) => macro.key === selectedMacro);
  const selected = macros[selectedIndex];
  const selectNextMacro = () => setSelectedMacro(macros[(selectedIndex + 1) % macros.length].key);
  return (
    <div className="macro-breakdown" role="group" aria-label={label}>
      <button className="macro-donut" type="button" style={{ background: chartBackground }} onClick={selectNextMacro} title="Show the next macro">
        <i><strong>{Math.round(selected.percent)}%</strong><span>{selected.label}</span></i>
      </button>
      <span className="macro-breakdown-key">
        {macros.map((macro) => <button className={`${macro.className}${selectedMacro === macro.key ? " active" : ""}`} type="button" key={macro.key} aria-pressed={selectedMacro === macro.key} onClick={() => setSelectedMacro(macro.key)}>{macro.label} {Math.round(macro.percent)}%{showAmounts ? ` - ${Math.round(macro.grams)} g` : ""}</button>)}
      </span>
    </div>
  );
}
