import { WaitingState } from "../components/WaitingState";
import { PageDataState } from "../components/PageDataState";
import { FormEvent, useEffect, useState } from "react";
import { Apple, CalendarDays, ChevronDown, Clock3, History, ListChecks, Moon, PlusCircle, ShoppingBasket, Sunrise, Sun, Utensils, Settings2 } from "lucide-react";
import { displayDate, localDateTimeValue, sentenceLabel } from "../format";
import { ApiError } from "../api";
import { AppAccordion } from "../components/AppAccordion";
import {
  addManualMeal,
  createShoppingList,
  generateMealPlan,
  getMealAlternatives,
  getMealPlanVersions,
  listMealPlans,
  moveMeal,
  regenerateMeal,
  regenerateMealPlan,
  restoreMealPlanVersion,
  swapMeal,
  type SessionRequest,
} from "../nutrition/api";
import type { DailyTargetPercentages, MealPlan, MealPlanVersion, NutritionValues, PlannedMeal, RecipeSearchResult } from "../nutrition/types";

const mealTypes = ["breakfast", "lunch", "dinner", "snack"];

function MealTime({ meal }: { meal: PlannedMeal }) {
  const snack = meal.mealType.startsWith("snack");
  const hour = Number(meal.time.split(":")[0]);
  const label = snack ? `${hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening"} snack` : displayMealType(meal.mealType);
  const Icon = snack ? Apple : meal.mealType === "breakfast" ? Sunrise : meal.mealType === "lunch" ? Sun : meal.mealType === "dinner" ? Moon : Utensils;
  const tone = snack ? "sage" : meal.mealType === "dinner" ? "clay" : "oat";
  return <div className="planned-meal-heading"><span className={`planned-meal-icon planned-meal-icon-${tone}`}><Icon aria-hidden="true" /></span><strong>{label}</strong><span className="planned-meal-time"><Clock3 aria-hidden="true" /><time dateTime={meal.scheduledAt ?? meal.time}>{meal.time}</time></span>{meal.scheduledAt === null && <span role="status">Choose a valid local time.</span>}</div>;
}

function TargetShares({ values, nutrition }: { values?: DailyTargetPercentages; nutrition?: NutritionValues }) {
  if (!values || Object.values(values).every(value => value === null)) return null;
  const labels = {calories: "Energy", protein: "Protein", carbs: "Carbohydrate", fats: "Fat"};
  const fields = {calories: "caloriesKcal", protein: "proteinG", carbs: "carbsG", fats: "fatsG"} as const;
  return <div className="meal-target-shares" aria-label="Share of daily targets">
    {(Object.keys(labels) as Array<keyof DailyTargetPercentages>).map(key => <div key={key}><span>{labels[key]}{nutrition ? `: ${Math.round(nutrition[fields[key]])} ${key === "calories" ? "kcal" : "g"}` : ""}</span><strong>{values[key] === null ? "No target" : `${Math.round(values[key])}% of daily target`}</strong>{values[key] !== null && <progress max={100} value={Math.min(100, values[key])} aria-label={`${labels[key]}: ${Math.round(values[key])}% of daily target`} />}</div>)}
  </div>;
}

function PlanNutritionTotals({ title, nutrition, percentages }: { title: string; nutrition: NutritionValues; percentages?: DailyTargetPercentages }) {
  return <section className="plan-nutrition-totals" aria-label={title}>
    <h3>{title}</h3>
    <div className="nutrition-score-row">
      <div><span>Energy</span><strong>{Math.round(nutrition.caloriesKcal)} kcal</strong></div>
      <div><span>Protein</span><strong>{Math.round(nutrition.proteinG)} g</strong></div>
      <div><span>Carbohydrate</span><strong>{Math.round(nutrition.carbsG)} g</strong></div>
      <div><span>Fat</span><strong>{Math.round(nutrition.fatsG)} g</strong></div>
    </div>
    <TargetShares values={percentages} />
  </section>;
}

function displayMealType(value: string): string {
  return sentenceLabel(value);
}

function todayValue(): string {
  return localDateTimeValue().slice(0, 10);
}

function displayIsoDateTime(value: string): string {
  return displayDate(value);
}

function planDate(value: string): string {
  return value;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function nutritionLine(meal: PlannedMeal): string {
  return `${Math.round(meal.nutrition.caloriesKcal)} kcal | ${Math.round(meal.nutrition.proteinG)} g protein | ${Math.round(meal.nutrition.carbsG)} g carbs | ${Math.round(meal.nutrition.fatsG)} g fat`;
}

export function MealPlanScreen({ request, signedIn }: { request: SessionRequest; signedIn: boolean }) {
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [duration, setDuration] = useState<"day" | "week">("day");
  const [startDate, setStartDate] = useState(todayValue);
  const [versionsPlanId, setVersionsPlanId] = useState<string | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionsRetry, setVersionsRetry] = useState(0);
  const [versions, setVersions] = useState<MealPlanVersion[]>([]);
  const [alternatives, setAlternatives] = useState<{ mealId: string; values: RecipeSearchResult[] } | null>(null);
  const [moveDates, setMoveDates] = useState<Record<string, string>>({});
  const [moveTypes, setMoveTypes] = useState<Record<string, string>>({});
  const [moveTimes, setMoveTimes] = useState<Record<string, string>>({});
  const [manualDate, setManualDate] = useState(todayValue);
  const [manualType, setManualType] = useState("dinner");
  const [manualTime, setManualTime] = useState("19:00");
  const [manualTitle, setManualTitle] = useState("");
  const [manualCalories, setManualCalories] = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [manualCarbs, setManualCarbs] = useState("");
  const [manualFat, setManualFat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayValue);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const moveMealTypes = Array.from(new Set([
    ...mealTypes,
    ...(plan?.days.flatMap((day) => day.meals.map((meal) => meal.mealType)) ?? []),
  ]));

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    setLoading(true);
    setLoaded(false);
    setError(null);
    request(listMealPlans)
      .then((savedPlans) => {
        if (!active) return;
        setPlans(savedPlans);
        setPlan(savedPlans[0] ?? null);
        setLoaded(true);
      })
      .catch((loadError: unknown) => { if (active) setError(errorMessage(loadError, "Meal plans could not be loaded.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, signedIn, retry]);

  useEffect(() => {
    if (!plan || !signedIn) {
      setVersions([]);
      return;
    }
    let active = true;
    setVersionsPlanId(null);
    setVersionsError(null);
    request((token) => getMealPlanVersions(plan.id, token))
      .then((values) => { if (active) { setVersions(values); setVersionsPlanId(plan.id); } })
      .catch((loadError: unknown) => { if (active) setVersionsError(errorMessage(loadError, "Plan versions could not be loaded.")); });
    return () => { active = false; };
  }, [plan, request, signedIn, versionsRetry]);

  if (!signedIn) {
    return (
      <section className="panel planner-panel">
        <p className="eyebrow">Meal planning</p>
        <h2>Sign in to save meal plans</h2>
        <p className="recipe-intro">Meal plans and shopping lists are saved with your account. The public recipe catalogue remains available without an account.</p>
      </section>
    );
  }

  const setPlanAndList = (next: MealPlan) => {
    setPlan(next);
    setPlans((current) => [next, ...current.filter((item) => item.id !== next.id)]);
  };

  const runChange = async (operation: (token: string) => Promise<MealPlan>, success: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setPlanAndList(await request(operation));
      setMessage(success);
      setAlternatives(null);
      return true;
    } catch (changeError: unknown) {
      setError(errorMessage(changeError, "The meal plan could not be changed."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const generate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await request((token) => generateMealPlan(duration, startDate, token));
      setPlanAndList(next);
      setMessage(`${duration === "week" ? "Weekly" : "Daily"} plan saved.`);
    } catch (generateError: unknown) {
      setError(errorMessage(generateError, "The meal plan could not be generated."));
    } finally {
      setBusy(false);
    }
  };

  const loadAlternatives = async (meal: PlannedMeal) => {
    if (!plan) return;
    setError(null);
    try {
      setAlternatives({ mealId: meal.id, values: await request((token) => getMealAlternatives(plan.id, meal.id, token)) });
    } catch (loadError: unknown) {
      setError(errorMessage(loadError, "Alternatives could not be loaded."));
    }
  };

  const addManual = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!plan) {
      setError("Generate a plan before adding a meal.");
      return;
    }
    const nutrition = {
      caloriesKcal: Number(manualCalories),
      proteinG: Number(manualProtein || 0),
      carbsG: Number(manualCarbs || 0),
      fatsG: Number(manualFat || 0),
      fiberG: 0,
      sugarG: 0,
      sodiumMg: 0,
      vitaminDMcg: 0,
      vitaminB12Mcg: 0,
      ironMg: 0,
      calciumMg: 0,
      magnesiumMg: 0,
    };
    const saved = await runChange((token) => addManualMeal(plan.id, { date: manualDate, mealType: manualType, time: manualTime, title: manualTitle, nutrition }, token), "Manual meal added.");
    if (!saved) return;
    setManualTitle("");
    setManualCalories("");
    setManualProtein("");
    setManualCarbs("");
    setManualFat("");
  };

  const createPlanList = async (mealId?: string) => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      await request((token) => createShoppingList(plan.id, mealId, token));
      setMessage(`${mealId ? "Meal" : "Plan"} shopping list saved. Open Shopping list to view it.`);
    } catch (listError: unknown) {
      setError(errorMessage(listError, "The shopping list could not be created."));
    } finally {
      setBusy(false);
    }
  };
  if (!loaded) return <PageDataState view="plan" title="Meal plan" loading={loading} error={error} onRetry={() => setRetry((value) => value + 1)} />;

  const planMealCount = plan?.days.reduce((total, day) => total + day.meals.length, 0) ?? 0;
  const activeDay = plan?.days.find((day) => day.date === selectedDate) ?? plan?.days.find((day) => day.date === todayValue()) ?? plan?.days[0];

  return (
    <section className="panel planner-panel">
      <header className="planner-focus">
        <div><p className="eyebrow">Meal plan</p><h2>{plan ? "Your meal plan" : "Plan your next meals"}</h2>
        <p>{plan ? "Choose a day, then review your meals." : "Choose a start date. Your saved food choices will guide the plan."}</p></div>
        {plan && <button className="primary-button planner-list-action" type="button" disabled={busy} aria-busy={busy} onClick={() => void createPlanList()}><ShoppingBasket aria-hidden="true" />Make shopping list</button>}
        {plan && <div className="planner-overview"><span><CalendarDays aria-hidden="true" />{planDate(plan.startDate)}{plan.startDate !== plan.endDate ? ` to ${planDate(plan.endDate)}` : ""}</span><span><Utensils aria-hidden="true" />{planMealCount} planned meals</span></div>}
      </header>
      {plan && <p className="muted-text planner-note">Meal times use {plan.timezone}. Repeated daylight-saving times use the earlier occurrence; skipped times cannot be saved.</p>}
      <p className="muted-text planner-note">Automatic plans use the meal-ready collection. Historical recipes remain available for browsing.</p>
      <AppAccordion key={plan ? "saved-plan-options" : "first-plan-options"} title={plan ? "Create or replace a plan" : "Create your first plan"} icon={Settings2} defaultOpen={!plan}>
      <p className="recipe-intro">Create a separate plan, or replace the meals in the selected plan. Earlier versions remain available below.</p>
      <form className="planner-generate" onSubmit={generate}>
        <label>Plan length<select value={duration} onChange={(event) => setDuration(event.target.value as "day" | "week")}><option value="day">One day</option><option value="week">Seven days</option></select></label>
        <label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <button className="primary-button compact-button" type="submit" disabled={busy} aria-busy={busy}>{busy ? "Working..." : "Generate plan"}</button>
        {plan && <button className="secondary-button" type="button" disabled={busy} onClick={() => void runChange((token) => regenerateMealPlan(plan.id, token), "Plan regenerated.")}>Regenerate plan</button>}
      </form>
      </AppAccordion>
      {busy && <WaitingState label="Working on your meal-plan request." detail="Your current plan stays visible until the update is ready." />}
      {error && <p className="error-text" role="alert">{error}</p>}
      {message && <p className="success-text" role="status">{message}</p>}
      {plan?.fallbackReason && plan.fallbackReason !== "not_configured" && <p className="muted-text planner-note" role="status">Online generation could not complete. {plan.source === "cache" ? "A saved result was used." : "This plan was created locally from catalogue recipes."} Nutrition still comes from the backend calculator.</p>}
      {!plan && !loading && <div className="planner-empty-state"><span aria-hidden="true"><CalendarDays /></span><div><strong>Your first plan is one step away</strong><p>Choose one day or seven days, then select Generate plan.</p></div></div>}
      {plan && (
        <>
          <nav className="planner-day-picker" aria-label="Choose a meal plan day">{plan.days.map((day) => <button key={day.date} type="button" aria-pressed={activeDay?.date === day.date} onClick={() => setSelectedDate(day.date)}><strong>{day.date === todayValue() ? "Today" : planDate(day.date)}</strong><span>{day.meals.length} meals</span></button>)}</nav>
          <div className="plan-days">
            {(activeDay ? [activeDay] : []).map((day) => (
              <AppAccordion className="plan-day" key={`${plan.id}-${day.date}`} title={planDate(day.date)} meta={`${Math.round(day.nutrition.caloriesKcal)} kcal planned`} icon={CalendarDays} defaultOpen>
                <PlanNutritionTotals title="Day totals" nutrition={day.nutrition} percentages={day.targetPercentages} />
                {day.review && <div className="muted-text" role="status"><p>{day.review.summary}</p>{day.review.gaps.length > 0 && <p>Below target: {day.review.gaps.join(", ")}.</p>}{day.review.excesses.length > 0 && <p>Above target: {day.review.excesses.join(", ")}.</p>}</div>}
                <div className="plan-meals">
                  {day.meals.map((meal) => (
                    <div className="planned-meal" key={meal.id}>
                      <div className="planned-meal-main">
                        <MealTime meal={meal} />
                        <h4>{meal.recipeId ? <a className="recipe-title-open" href={`/recipes?recipe=${encodeURIComponent(meal.recipeId)}`}>{meal.title}</a> : meal.title}{meal.manual ? " (manual)" : meal.source === "generated" ? " (created)" : ""}</h4>
                        <TargetShares values={meal.targetPercentages} nutrition={meal.nutrition} />
                        <span className="planned-meal-energy">{Math.round(meal.nutrition.caloriesKcal)} kcal</span>
                      </div>
                      <details className="planned-meal-edit">
                        <summary><Settings2 aria-hidden="true" /><span>Meal options<span className="planned-meal-options-context"> for {meal.title}</span></span><ChevronDown className="planned-meal-chevron" aria-hidden="true" /></summary>
                        <p className="muted-text">{nutritionLine(meal)}</p>
                        {meal.recipeSnapshot && <details className="created-plan-recipe"><summary>Ingredients and cooking steps</summary><p className="muted-text">Created with Hale. Not kitchen-tested. Amounts below cover {meal.servings} servings.</p><ul>{meal.recipeSnapshot.ingredients.map(item => <li key={item.id}>{item.name}: {item.quantity} {item.unit}</li>)}</ul><ol>{meal.recipeSnapshot.preparation.map(step => <li key={step.step}>{step.description}</li>)}</ol></details>}
                        <div className="planned-meal-actions">
                          <div className="planned-meal-quick-actions">
                            {meal.recipeId && <button className="text-button" type="button" disabled={busy} onClick={() => void loadAlternatives(meal)}>Swap</button>}
                            {meal.recipeId && <button className="text-button" type="button" disabled={busy} onClick={() => void createPlanList(meal.id)}>Make list</button>}
                            <button className="text-button" type="button" disabled={busy || !meal.recipeId} onClick={() => plan && void runChange((token) => regenerateMeal(plan.id, meal.id, token), "Meal regenerated.")}>Regenerate</button>
                          </div>
                          <label>Move to<select value={moveDates[meal.id] ?? meal.date} onChange={(event) => setMoveDates((current) => ({ ...current, [meal.id]: event.target.value }))}>{plan.days.map((targetDay) => <option key={targetDay.date} value={targetDay.date}>{targetDay.date}</option>)}</select></label>
                          <label>Type<select value={moveTypes[meal.id] ?? meal.mealType} onChange={(event) => setMoveTypes((current) => ({ ...current, [meal.id]: event.target.value }))}>{moveMealTypes.map((type) => <option key={type} value={type}>{displayMealType(type)}</option>)}</select></label>
                          <label>Time<input type="time" value={moveTimes[meal.id] ?? meal.time} onChange={(event) => setMoveTimes((current) => ({ ...current, [meal.id]: event.target.value }))} required /></label>
                          <button className="secondary-button compact-button" type="button" disabled={busy} onClick={() => plan && void runChange((token) => moveMeal(plan.id, meal.id, moveDates[meal.id] ?? meal.date, moveTypes[meal.id] ?? meal.mealType, moveTimes[meal.id] ?? meal.time, token), "Meal moved.")}>Move</button>
                        </div>
                        {alternatives?.mealId === meal.id && <div className="meal-alternatives"><p className="metric-label">Available alternatives</p>{alternatives.values.slice(0, 4).map((alternative) => <button className="text-button" type="button" key={alternative.recipe.id} disabled={busy} onClick={() => plan && void runChange((token) => swapMeal(plan.id, meal.id, alternative.recipe.id, meal.servings, token), "Meal swapped.")}>{alternative.recipe.title} ({Math.round(alternative.nutrition.caloriesKcal)} kcal)</button>)}</div>}
                      </details>
                    </div>
                  ))}
                </div>
              </AppAccordion>
            ))}
          </div>
          <PlanNutritionTotals title={plan.duration === "week" ? "Week totals" : "Plan totals"} nutrition={plan.nutrition} />
          {plan.insights && <AppAccordion title="Nutrition overview" eyebrow="Plan details" icon={ListChecks} tone="oat"><div className="plan-insight-grid"><div><span>Balance</span><strong>{plan.insights.nutritionalBalanceScore} / 10</strong></div><div><span>Variety</span><strong>{plan.insights.diversityIndex} / 10</strong></div><div><span>Micronutrient coverage</span><strong>{plan.insights.micronutrientCoverage.percentage}%</strong></div><div><span>Protein consistency</span><strong>{displayMealType(plan.insights.weeklyTrends.proteinConsistency)}</strong></div></div>{plan.insights.micronutrientCoverage.low.length > 0 && <p className="muted-text">Below reference: {plan.insights.micronutrientCoverage.low.join(", ")}.</p>}{plan.insights.micronutrientCoverage.high.length > 0 && <p className="muted-text">Above limit: {plan.insights.micronutrientCoverage.high.join(", ")}.</p>}</AppAccordion>}
          <AppAccordion title="Add a meal yourself" eyebrow="Manual meal" icon={PlusCircle} tone="oat">
            <form className="manual-meal-form compact-accordion-form" onSubmit={addManual}>
              <label>Date<input type="date" min={plan.startDate} max={plan.endDate} value={manualDate} onChange={(event) => setManualDate(event.target.value)} required /></label>
              <label>Type<select value={manualType} onChange={(event) => setManualType(event.target.value)}>{mealTypes.map((type) => <option key={type} value={type}>{displayMealType(type)}</option>)}</select></label>
              <label>Time<input type="time" value={manualTime} onChange={(event) => setManualTime(event.target.value)} /></label>
              <label>Name<input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="Home meal" required /></label>
              <label>Calories<input type="number" min="1" value={manualCalories} onChange={(event) => setManualCalories(event.target.value)} required /></label>
              <label>Protein<input type="number" min="0" value={manualProtein} onChange={(event) => setManualProtein(event.target.value)} placeholder="0" /></label>
              <label>Carbs<input type="number" min="0" value={manualCarbs} onChange={(event) => setManualCarbs(event.target.value)} placeholder="0" /></label>
              <label>Fat<input type="number" min="0" value={manualFat} onChange={(event) => setManualFat(event.target.value)} placeholder="0" /></label>
              <button className="primary-button compact-button" type="submit" disabled={busy} aria-busy={busy}>Add meal</button>
            </form>
          </AppAccordion>
          <AppAccordion title="Restore an earlier plan" eyebrow="Saved versions" meta={versionsPlanId === plan.id ? `${versions.length} version(s)` : versionsError ? "Unavailable" : "Loading"} icon={History} tone="clay">
            {versionsPlanId !== plan.id ? <PageDataState compact view="list" title="Plan versions" loading={!versionsError} error={versionsError} onRetry={() => setVersionsRetry((value) => value + 1)} /> : <div className="plan-versions compact-plan-versions">
            {versions.map((version) => <div className="plan-version-row" key={version.id}><span>Version {version.version}: {version.label}</span><span>{displayIsoDateTime(version.createdAt)}</span><button className="text-button" type="button" disabled={busy || version.version === plan.version} onClick={() => void runChange((token) => restoreMealPlanVersion(plan.id, version.id, token), "Plan version restored.")}>Restore</button></div>)}
            </div>}
          </AppAccordion>
        </>
      )}
      {plans.length > 1 && <label className="saved-plan-select">Saved plans<select value={plan?.id ?? ""} onChange={(event) => setPlan(plans.find((item) => item.id === event.target.value) ?? null)}>{plans.map((savedPlan) => <option key={savedPlan.id} value={savedPlan.id}>{savedPlan.startDate} to {savedPlan.endDate} (v{savedPlan.version})</option>)}</select></label>}
    </section>
  );
}
