import { PageDataState } from "../components/PageDataState";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartLine, History, MessageCircle, Settings2, Utensils } from "lucide-react";
import { AppAccordion } from "../components/AppAccordion";
import { NutritionProgress } from "../components/NutritionProgress";
import { NutritionTrends } from "../components/NutritionTrends";
import {
  getNutritionDefaults,
  getNutritionPreferences,
  getNutritionPreferenceHistory,
  getNutritionProgress,
  listMealPlans,
  listNutritionIntake,
  recordManualIntake,
  recordPlanMeal,
  removeNutritionIntake,
  saveNutritionFeedback,
  saveNutritionPreferences,
  type SessionRequest,
} from "../nutrition/api";
import { allergyOptions, dietaryPreferenceOptions, nutritionLabel } from "../nutrition/preferences";
import { loggedMealIds, mealsForDate } from "../nutrition/meal-tracking";
import type { MealPlan, NutritionIntakeRecord, NutritionPreferences, NutritionProgressResult, NutritionValues } from "../nutrition/types";

interface NutritionScreenProps {
  request: SessionRequest;
  signedIn: boolean;
}

const emptyNutrition: NutritionValues = {
  caloriesKcal: 0,
  proteinG: 0,
  carbsG: 0,
  fatsG: 0,
  fiberG: 0,
  sugarG: 0,
  sodiumMg: 0,
  vitaminDMcg: 0,
  vitaminB12Mcg: 0,
  ironMg: 0,
  calciumMg: 0,
  magnesiumMg: 0,
};

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function splitList(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

const suggestedMealTimes: Record<number, string[]> = {
  1: ["12:00"],
  2: ["08:00", "19:00"],
  3: ["08:00", "13:00", "19:00"],
  4: ["08:00", "12:00", "16:00", "20:00"],
  5: ["07:00", "10:30", "14:00", "17:30", "21:00"],
  6: ["07:00", "10:00", "13:00", "16:00", "19:00", "22:00"],
  7: ["06:30", "09:15", "12:00", "14:45", "17:30", "20:15", "23:00"],
  8: ["06:00", "08:30", "11:00", "13:30", "16:00", "18:30", "21:00", "23:30"],
};

function mealTimesForCount(current: string[], count: number): string[] {
  if (current.length === count) return current;
  return suggestedMealTimes[count] ?? suggestedMealTimes[3];
}

export function NutritionScreen({ request, signedIn }: NutritionScreenProps) {
  const loadVersion = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState<NutritionProgressResult | null>(null);
  const [records, setRecords] = useState<NutritionIntakeRecord[]>([]);
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
  const [preferences, setPreferences] = useState<NutritionPreferences | null>(null);
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [calories, setCalories] = useState(0);
  const [protein, setProtein] = useState(0);
  const [carbs, setCarbs] = useState(0);
  const [fats, setFats] = useState(0);
  const [loggingMode, setLoggingMode] = useState<"planned" | "manual">("planned");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const recordDate = date || progress?.trend.at(-1)?.date || localDate();
  const { plan: selectedPlan, meals: planMeals } = useMemo(() => mealsForDate(plans, recordDate), [plans, recordDate]);
  const loggedPlanMealIds = useMemo(() => loggedMealIds(records, recordDate), [records, recordDate]);
  const selectedMeal = useMemo(() => planMeals.find((meal) => !loggedPlanMealIds.has(meal.id)) ?? null, [loggedPlanMealIds, planMeals]);
  const selectedMealNumber = selectedMeal ? planMeals.findIndex((meal) => meal.id === selectedMeal.id) + 1 : 0;

  const load = useCallback(async () => {
    if (!signedIn) return;
    const version = ++loadVersion.current;
    setBusy(true);
    setError(null);
    try {
      const [nextProgress, nextRecords, nextPlans, preferenceHistory, savedPreferences, defaultPreferences] = await Promise.all([
        request(getNutritionProgress),
        request(listNutritionIntake),
        request(listMealPlans),
        request(getNutritionPreferenceHistory),
        request(getNutritionPreferences),
        request(getNutritionDefaults),
      ]);
      if (version !== loadVersion.current) return;
      setLoaded(true);
      setProgress(nextProgress);
      setRecords(nextRecords);
      setPlans(nextPlans);
      setHistoryCount(preferenceHistory.length);
      setPreferences(savedPreferences ?? defaultPreferences);
      if (nextPlans.length === 0) setLoggingMode("manual");
    } catch (loadError: unknown) {
      if (version !== loadVersion.current) return;
      setError(loadError instanceof Error ? loadError.message : "Nutrition progress could not be loaded.");
    } finally {
      if (version === loadVersion.current) setBusy(false);
    }
  }, [request, signedIn]);

  useEffect(() => {
    setLoaded(false);
    void load();
    return () => { loadVersion.current += 1; };
  }, [load]);

  const run = async (operation: () => Promise<void>, success: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await operation();
      setMessage(success);
      await load();
    } catch (operationError: unknown) {
      setError(operationError instanceof Error ? operationError.message : "The nutrition record could not be changed.");
    } finally {
      setBusy(false);
    }
  };

  const saveManual = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nutrition = { ...emptyNutrition, caloriesKcal: calories, proteinG: protein, carbsG: carbs, fatsG: fats };
    void run(async () => {
      await request((token) => recordManualIntake({ date: recordDate, title, nutrition }, token));
      setTitle("");
      setCalories(0);
      setProtein(0);
      setCarbs(0);
      setFats(0);
    }, "Nutrition intake saved.");
  };

  const saveSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!preferences) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await request((token) => saveNutritionPreferences({ ...preferences, effectiveFrom: new Date().toISOString() }, token));
      setPreferences(saved);
      setMessage("Nutrition settings saved.");
      await load();
    } catch (settingsError: unknown) {
      setError(settingsError instanceof Error ? settingsError.message : "Nutrition settings could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  if (!signedIn) {
    return <section className="panel"><p className="eyebrow">Nutrition</p><h2>Sign in to keep nutrition records</h2><p className="muted-text">Recipe search still works for guests. Intake, progress, and feedback stay with a signed-in account.</p></section>;
  }

  if (!loaded) return <PageDataState view="form" title="Nutrition" loading={busy} error={error} onRetry={() => void load()} />;

  return (
    <div className="nutrition-page">
      {error && <div className="notice error" role="alert">{error}</div>}
      {message && <div className="notice success" role="status">{message}</div>}
      <section className="panel nutrition-log-card">
        <div className="nutrition-log-heading">
          <span className="nutrition-log-icon"><Utensils aria-hidden="true" /></span>
          <div><p className="eyebrow">Next step</p><h2>Log a meal</h2><p>Use a planned meal when it is ready. Enter a meal yourself when it is not.</p></div>
        </div>
        <div className="nutrition-log-tabs segmented-switch" role="tablist" aria-label="Meal logging method" data-index={loggingMode === "planned" ? "0" : "1"} data-segments="2">
          <button type="button" role="tab" aria-selected={loggingMode === "planned"} className={loggingMode === "planned" ? "active" : ""} onClick={() => setLoggingMode("planned")} disabled={plans.length === 0}>Planned meal</button>
          <button type="button" role="tab" aria-selected={loggingMode === "manual"} className={loggingMode === "manual" ? "active" : ""} onClick={() => setLoggingMode("manual")}>Manual entry</button>
        </div>

        {loggingMode === "planned" && plans.length > 0 ? (
          <div className="nutrition-log-workflow" role="tabpanel">
            <label>Date<input type="date" value={recordDate} onChange={(event) => setDate(event.target.value)} required /></label>
            {selectedMeal && selectedPlan ? <>
              <div className="nutrition-meal-preview nutrition-next-meal">
                <div>
                  <span>Next from plan · Meal {selectedMealNumber} of {planMeals.length}</span>
                  <strong>{selectedMeal.title}</strong>
                  <small>{selectedMeal.date} at {selectedMeal.time}</small>
                </div>
                <div className="nutrition-meal-energy"><strong>{Math.round(selectedMeal.nutrition.caloriesKcal)}</strong><span>kcal</span></div>
              </div>
              <button className="primary-button nutrition-log-submit" type="button" disabled={busy} onClick={() => void run(async () => { await request((token) => recordPlanMeal(selectedPlan.id, selectedMeal.id, token)); }, "Planned meal recorded.")}>Log next meal</button>
            </> : <div className="nutrition-plan-complete"><strong>{selectedPlan ? "Day complete" : "No plan for this date"}</strong><p>{selectedPlan ? "All planned meals for this date are logged. Use manual entry for anything else." : "Choose a date with a saved plan or use manual entry."}</p></div>}
          </div>
        ) : (
          <form className="nutrition-log-workflow" role="tabpanel" onSubmit={saveManual}>
            <div className="nutrition-log-fields nutrition-log-fields-manual">
              <label>Meal name<input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} placeholder="Lunch" required /></label>
              <label>Date<input type="date" value={recordDate} onChange={(event) => setDate(event.target.value)} required /></label>
              <NumberField label="Calories" value={calories} onChange={setCalories} required />
            </div>
            <details className="nutrition-inline-details">
              <summary>Add macros <span>Optional</span></summary>
              <div className="nutrition-number-grid">
                <NumberField label="Protein, g" value={protein} onChange={setProtein} />
                <NumberField label="Carbohydrate, g" value={carbs} onChange={setCarbs} />
                <NumberField label="Fat, g" value={fats} onChange={setFats} />
              </div>
            </details>
            <button className="primary-button nutrition-log-submit" type="submit" disabled={busy}>Save meal</button>
          </form>
        )}
        {plans.length === 0 && loggingMode === "manual" && <p className="nutrition-log-note">No meal plan is ready. Manual entry is available.</p>}
      </section>

      <section className="panel nutrition-daily-card">
        <div className="panel-heading"><div><p className="eyebrow">Today</p><h2>Your nutrition</h2></div><button className="secondary-button" type="button" disabled={busy} onClick={() => void load()}>{busy ? "Loading..." : "Refresh"}</button></div>
        {progress ? <NutritionProgress progress={progress} /> : <p className="muted-text">No progress is ready yet.</p>}
      </section>

      {progress && <AppAccordion title="Calories and macros" eyebrow="Trends" meta={`${progress.trend.length} day(s)`} icon={ChartLine} tone="oat"><NutritionTrends points={progress.trend} /></AppAccordion>}

      {preferences && <NutritionSettings preferences={preferences} historyCount={historyCount} busy={busy} onChange={setPreferences} onSubmit={saveSettings} />}

      <AppAccordion title="Saved records" eyebrow="Intake" meta={`${records.length} record(s)`} icon={History} tone="clay">
        {records.length === 0 ? <p className="muted-text">Record a meal to start nutrition progress.</p> : <div className="intake-list">{records.map((record) => <div className="intake-row" key={record.id}><div><strong>{record.entries.map((entry) => entry.title).join(", ")}</strong><span>{record.date} · {Math.round(record.nutrition.caloriesKcal)} kcal · {Math.round(record.nutrition.proteinG)} g protein</span></div><button className="text-button danger-text" type="button" disabled={busy} onClick={() => void run(async () => { await request((token) => removeNutritionIntake(record.id, token)); }, "Nutrition intake removed.")}>Remove</button></div>)}</div>}
      </AppAccordion>

      {progress && progress.summary.suggestions.length > 0 && <AppAccordion title="Review one suggestion" eyebrow="Feedback" icon={MessageCircle}><p>{progress.summary.suggestions[0]}</p><div className="button-row"><button className="secondary-button" type="button" disabled={busy} onClick={() => void run(async () => { await request((token) => saveNutritionFeedback({ subjectType: "suggestion", subjectId: progress.summary.suggestions[0], rating: "helpful", decision: "accepted" }, token)); }, "Feedback saved.")}>Helpful</button><button className="secondary-button" type="button" disabled={busy} onClick={() => void run(async () => { await request((token) => saveNutritionFeedback({ subjectType: "suggestion", subjectId: progress.summary.suggestions[0], rating: "not_helpful", decision: "rejected" }, token)); }, "Feedback saved.")}>Not useful</button></div></AppAccordion>}
    </div>
  );
}

function NumberField({ label, value, onChange, required = false }: { label: string; value: number; onChange: (value: number) => void; required?: boolean }) {
  return <label>{label}<input type="number" min={0} max={100000} step="0.1" value={value} onChange={(event) => onChange(Number(event.target.value))} required={required} /></label>;
}

function NutritionSettings({ preferences, historyCount, busy, onChange, onSubmit }: {
  preferences: NutritionPreferences;
  historyCount: number;
  busy: boolean;
  onChange: (value: NutritionPreferences) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const toggle = (field: "dietaryPreferences" | "allergies", value: string) => {
    const current = preferences[field];
    onChange({ ...preferences, [field]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] });
  };
  return (
    <AppAccordion className="nutrition-settings" title="Nutrition preferences and targets" eyebrow="Settings" meta={`${historyCount} saved version(s)`} icon={Settings2}>
        <p className="muted-text nutrition-settings-intro">These values start from the saved health profile. Confirm them here. Haleview does not ask for age, height, weight, goal, or activity again.</p>
        <form onSubmit={onSubmit}>
          <fieldset><legend>Dietary preferences</legend><p className="muted-text">Mediterranean and flexitarian choices guide recipe ranking. Other diet choices and allergies filter eligible recipes.</p><div className="choice-grid">{dietaryPreferenceOptions.map((value) => <label key={value}><input type="checkbox" checked={preferences.dietaryPreferences.includes(value)} onChange={() => toggle("dietaryPreferences", value)} />{nutritionLabel(value)}</label>)}</div></fieldset>
          <fieldset><legend>Allergies and intolerances</legend><div className="choice-grid">{allergyOptions.map((value) => <label key={value}><input type="checkbox" checked={preferences.allergies.includes(value)} onChange={() => toggle("allergies", value)} />{nutritionLabel(value)}</label>)}</div></fieldset>
          <section className="nutrition-settings-section">
            <div className="nutrition-settings-section-heading"><div><span>Food choices</span><strong>Personal filters</strong></div><p>Optional items used when Haleview finds recipes.</p></div>
            <div className="settings-input-grid nutrition-food-inputs">
            <ListTextInput label="Disliked ingredients" values={preferences.dislikedIngredients} onValuesChange={(values) => onChange({ ...preferences, dislikedIngredients: values })} />
            <ListTextInput label="Preferred cuisines" values={preferences.cuisinePreferences} onValuesChange={(values) => onChange({ ...preferences, cuisinePreferences: values })} />
            </div>
          </section>
          <section className="nutrition-settings-section">
            <div className="nutrition-settings-section-heading"><div><span>Daily targets</span><strong>Nutrition guide</strong></div><p>Used for progress and meal planning.</p></div>
            <div className="nutrition-target-summary">
              <div className="nutrition-energy-target"><span>Energy</span><strong>{Math.round(preferences.calorieTargetKcal).toLocaleString()}</strong><small>kcal per day</small></div>
              <div className="nutrition-macro-targets">
                <div className="tone-sage"><span>Protein</span><strong>{Math.round(preferences.macroTargets.proteinG)} g</strong></div>
                <div className="tone-oat"><span>Carbohydrate</span><strong>{Math.round(preferences.macroTargets.carbsG)} g</strong></div>
                <div className="tone-clay"><span>Fat</span><strong>{Math.round(preferences.macroTargets.fatsG)} g</strong></div>
              </div>
            </div>
            <details className="nutrition-inline-details nutrition-settings-editor">
              <summary>Adjust daily targets <span>4 values</span></summary>
              <div className="settings-input-grid nutrition-target-inputs">
                <label>Calories, kcal<input type="number" min="500" max="10000" value={preferences.calorieTargetKcal} onChange={(event) => onChange({ ...preferences, calorieTargetKcal: Number(event.target.value) })} required /></label>
                <label>Protein, g<input type="number" min="0" max="1000" value={preferences.macroTargets.proteinG} onChange={(event) => onChange({ ...preferences, macroTargets: { ...preferences.macroTargets, proteinG: Number(event.target.value) } })} required /></label>
                <label>Carbohydrate, g<input type="number" min="0" max="2000" value={preferences.macroTargets.carbsG} onChange={(event) => onChange({ ...preferences, macroTargets: { ...preferences.macroTargets, carbsG: Number(event.target.value) } })} required /></label>
                <label>Fat, g<input type="number" min="0" max="1000" value={preferences.macroTargets.fatsG} onChange={(event) => onChange({ ...preferences, macroTargets: { ...preferences.macroTargets, fatsG: Number(event.target.value) } })} required /></label>
              </div>
            </details>
          </section>
          <section className="nutrition-settings-section">
            <div className="nutrition-settings-section-heading"><div><span>Meal schedule</span><strong>Daily rhythm</strong></div><p>Times use {preferences.timezone}.</p></div>
            <div className="nutrition-schedule-summary">
              <div><strong>{preferences.mealsPerDay}</strong><span>meals</span></div>
              <div><strong>{preferences.snacksPerDay}</strong><span>snacks</span></div>
              <div className="nutrition-schedule-times"><strong>{preferences.mealTimes.join(" · ")}</strong><span>planned meal times</span></div>
            </div>
            <details className="nutrition-inline-details nutrition-settings-editor">
              <summary>Edit meal schedule <span>{preferences.mealTimes.length} meal times</span></summary>
              <div className="nutrition-schedule-editor">
                <div className="settings-input-grid">
                  <label>Meals per day<input type="number" min="1" max="8" value={preferences.mealsPerDay} onChange={(event) => { const mealsPerDay = Number(event.target.value); onChange({ ...preferences, mealsPerDay, mealTimes: mealTimesForCount(preferences.mealTimes, mealsPerDay) }); }} required /></label>
                  <label>Snacks per day<input type="number" min="0" max="5" value={preferences.snacksPerDay} onChange={(event) => onChange({ ...preferences, snacksPerDay: Number(event.target.value) })} required /></label>
                  <label>Timezone<input value={preferences.timezone} maxLength={80} onChange={(event) => onChange({ ...preferences, timezone: event.target.value })} required /></label>
                </div>
                <fieldset><legend>Meal times</legend><div className="meal-time-grid">{preferences.mealTimes.map((time, index) => <label key={index}>Meal {index + 1}<input type="time" value={time} onChange={(event) => onChange({ ...preferences, mealTimes: preferences.mealTimes.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} required /></label>)}</div></fieldset>
              </div>
            </details>
          </section>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving..." : "Save nutrition settings"}</button>
        </form>
    </AppAccordion>
  );
}

function ListTextInput({ label, values, onValuesChange }: { label: string; values: string[]; onValuesChange: (values: string[]) => void }) {
  const [draft, setDraft] = useState(values.join(", "));
  return <label>{label}<input value={draft} onChange={(event) => { setDraft(event.target.value); onValuesChange(splitList(event.target.value)); }} placeholder="Separate values with commas" /></label>;
}
