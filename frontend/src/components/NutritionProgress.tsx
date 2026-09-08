import type { NutritionProgressResult } from "../nutrition/types";
import { ListChecks } from "lucide-react";
import { AppAccordion } from "./AppAccordion";
import { MacroBreakdown } from "./NutritionSummary";

interface NutritionProgressProps {
  progress: NutritionProgressResult;
  compact?: boolean;
}

function percent(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(value / target * 100)));
}

function statusLabel(status: NutritionProgressResult["today"]["calorieStatus"]): string {
  if (status === "on_target") return "On target";
  if (status === "surplus") return "Above target";
  return "Below target";
}

export function NutritionProgress({ progress, compact = false }: NutritionProgressProps) {
  const { today, targets } = progress;
  const balanceText = today.calorieBalanceKcal > 0
    ? `${Math.round(today.calorieBalanceKcal)} kcal over target`
    : today.calorieBalanceKcal < 0
      ? `${Math.abs(Math.round(today.calorieBalanceKcal))} kcal left`
      : "Daily target met";
  const dailyStatus = today.recordCount === 0 ? "Ready to start" : statusLabel(today.calorieStatus);
  return (
    <section className={`nutrition-progress ${compact ? "nutrition-progress-compact" : ""}`} aria-label="Nutrition progress">
      <div className="nutrition-day-summary">
        <div>
          <span>Today</span>
          <strong>{dailyStatus}</strong>
          <p>{today.recordCount === 0 ? "Log one meal to start today's progress." : `${today.recordCount} ${today.recordCount === 1 ? "meal" : "meals"} recorded.`}</p>
        </div>
        <div className="nutrition-day-energy"><strong>{Math.round(today.nutrition.caloriesKcal).toLocaleString()}</strong><span>of {Math.round(targets.caloriesKcal).toLocaleString()} kcal</span></div>
      </div>
      <div className={`calorie-progress calorie-${today.calorieStatus}`}>
        <div><span>Daily energy</span><strong>{balanceText}</strong></div>
        <span className="calorie-progress-track" aria-label={`Calories ${percent(today.nutrition.caloriesKcal, targets.caloriesKcal)} percent of target, ${statusLabel(today.calorieStatus)}`}><span style={{ width: `${percent(today.nutrition.caloriesKcal, targets.caloriesKcal)}%` }} /><i aria-hidden="true" /></span>
      </div>
      {compact ? <div className="nutrition-bars">
          <NutritionBar label="Protein" value={today.nutrition.proteinG} target={targets.proteinG} unit="g" />
          <NutritionBar label="Carbohydrate" value={today.nutrition.carbsG} target={targets.carbsG} unit="g" />
          <NutritionBar label="Fat" value={today.nutrition.fatsG} target={targets.fatsG} unit="g" />
        </div> : (
        <AppAccordion className="nutrition-detail-accordion" title="Scores and nutrients" eyebrow="More detail" icon={ListChecks}>
          <div className="nutrition-detail-grid">
            <div className="nutrition-score-row" aria-label="Daily calorie averages">
              <div><span>7-day average</span><strong>{Math.round(progress.week.dailyAverage.caloriesKcal)} kcal/day</strong></div>
              <div><span>30-day average</span><strong>{Math.round(progress.month.dailyAverage.caloriesKcal)} kcal/day</strong></div>
              <div><span>Daily target</span><strong>{Math.round(targets.caloriesKcal)} kcal/day</strong></div>
            </div>
            <p className="muted-text">Averages include every day in the period. Days without records count as zero.</p>
            <div className="nutrition-score-row">
              <div><span>Nutrition score</span><strong>{progress.nutritionScore}</strong></div>
              <div><span>Wellness score</span><strong>{progress.wellnessScore}</strong></div>
              <div><span>Meals recorded</span><strong>{today.recordCount}</strong></div>
              <div><span>Daily status</span><strong>{dailyStatus}</strong></div>
            </div>
            <div className="nutrition-bars">
              <NutritionBar label="Protein" value={today.nutrition.proteinG} target={targets.proteinG} unit="g" />
              <NutritionBar label="Carbohydrate" value={today.nutrition.carbsG} target={targets.carbsG} unit="g" />
              <NutritionBar label="Fat" value={today.nutrition.fatsG} target={targets.fatsG} unit="g" />
            </div>
            <MacroBreakdown nutrition={today.nutrition} label="Daily macro breakdown" />
            <div className="micronutrient-section">
              <div className="micronutrient-heading"><strong>Daily micronutrients</strong><span>General adult Daily Values</span></div>
              <div className="micronutrient-grid">
                {progress.micronutrientGuidance.map((item) => <MicronutrientRow key={item.key} item={item} />)}
              </div>
            </div>
            <div className="nutrition-advice">
              <div><span className="source-label">{progress.summary.source === "deepseek" ? "Online review" : "Local review"}</span><p>{progress.summary.text}</p></div>
              {progress.summary.suggestions.length > 0 && <ul>{progress.summary.suggestions.map((item) => <li key={item}>{item}</li>)}</ul>}
            </div>
          </div>
        </AppAccordion>
      )}
    </section>
  );
}

function MicronutrientRow({ item }: { item: NutritionProgressResult["micronutrientGuidance"][number] }) {
  const width = Math.max(0, Math.min(100, item.percent));
  const value = item.unit === "mcg" || item.current < 10 ? item.current.toFixed(1) : Math.round(item.current).toString();
  const target = item.target < 10 ? item.target.toFixed(1) : Math.round(item.target).toString();
  const status = item.status === "within_reference" ? "Within reference" : item.status === "high" ? "Above limit" : "Below reference";
  return (
    <div className={`micronutrient-row micronutrient-${item.status}`}>
      <div><span>{item.label}</span><strong>{value} / {target} {item.unit}</strong></div>
      <span className="micronutrient-track" role="progressbar" aria-label={`${item.label}: ${item.percent} percent of the general daily reference`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={width}><i style={{ width: `${width}%` }} /></span>
      <div className="micronutrient-note"><b>{status}</b><span>{item.guidance}</span>{item.recipes.length > 0 && <span>Try: {item.recipes.map((recipe) => recipe.title).join(" or ")}.</span>}</div>
    </div>
  );
}

function NutritionBar({ label, value, target, unit }: { label: string; value: number; target: number; unit: string }) {
  const width = percent(value, target);
  return (
    <div className="nutrition-bar-row">
      <div><span>{label}</span><strong>{Math.round(value)} / {Math.round(target)} {unit}</strong></div>
      <span className="nutrition-bar-track" aria-label={`${label} ${width} percent of target`}><span style={{ width: `${width}%` }} /></span>
    </div>
  );
}
