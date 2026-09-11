import { mealTypes, shiftDate } from "./data.js";
import type { ChatReference, ChatTurn } from "./types.js";

export interface SuggestedCall { name: string; args: Record<string, unknown> }

function referenceCall(reference: ChatReference): SuggestedCall[] {
  if (reference.topic === "recipe" || reference.topic === "meal") {
    const selection = reference.mealType ? { date: reference.date ?? "today", mealType: reference.mealType }
      : reference.recipeId ? { recipeId: reference.recipeId, ...(reference.servings ? { servings: reference.servings } : {}) } : null;
    return selection ? [{ name: "get_recipe", args: { ...selection, view: reference.view === "nutrition" ? "nutrition" : "recipe" } }]
      : [{ name: "get_meal_plan", args: { date: reference.date ?? "today" } }];
  }
  if (reference.topic === "nutrition") return [{ name: "get_nutrition_intake", args: { period: reference.period ?? "today", view: reference.view === "trend" ? "trend" : "summary" } }];
  if (reference.topic === "progress") return [{ name: "get_health_progress", args: { period: reference.period ?? "month", metric: reference.metric ?? "weight" } }];
  if (reference.topic === "goals") return [{ name: "get_health_goals", args: {} }];
  if (reference.topic === "wellness") return [{ name: "get_wellness_guidance", args: { topic: reference.wellnessTopic ?? "activity" } }];
  return [{ name: "get_health_metrics", args: { metrics: reference.metrics ?? [reference.metric ?? "weight"], ...(reference.date ? { date: reference.date } : {}) } }];
}

export function suggestedTools(message: string, history: ChatTurn[], today: string): SuggestedCall[] {
  const text = message.toLowerCase();
  const previous = history.at(-1)?.reference;
  const explicitMeal = mealTypes.find((meal) => new RegExp(`\\b${meal}\\b`, "u").test(text)) ?? (/tonight(?:'s)? meal/u.test(text) ? "dinner" : undefined);
  const followUp = /\b(it|that|those|this|more|again|why|enough)\b/u.test(text);
  const mealReference = /\b(it|that|those|this meal|same meal)\b/u.test(text);
  const mealType = explicitMeal ?? (mealReference && previous?.topic === "recipe" ? previous.mealType : undefined);
  const explicitDate = text.match(/\b\d{4}-\d{2}-\d{2}\b/u)?.[0];
  let date = explicitDate ?? (text.includes("tomorrow") ? "tomorrow" : text.includes("yesterday") ? "yesterday" : followUp && previous?.date ? previous.date : "today");
  const period = /last month/u.test(text) ? "last_month" : /month/u.test(text) ? "month" : /week/u.test(text) ? "week" : "today";
  const nutrients = /\b(nutrients?|nutrition|protein|calories|macros?|macronutrients?|carbohydrates?|carbs?|fat|fats|intake|eaten|consumed)\b/u.test(text);
  const preparation = /\b(recipe|ingredients?|prepare|preparation|cook|cooking|instructions?|steps?)\b/u.test(text);
  const recipeId = text.match(/\b(recipe-[a-z0-9._-]+|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\b/u)?.[0];
  if (mealType && (preparation || nutrients || followUp)) return [{ name: "get_recipe", args: { date, mealType, view: nutrients && !preparation ? "nutrition" : "recipe" } }];
  if (recipeId) return [{ name: "get_recipe", args: { recipeId, view: nutrients && !preparation ? "nutrition" : "recipe" } }];
  if (previous?.topic === "recipe" && mealReference && (nutrients || preparation)) return referenceCall(previous).map((call) => ({ ...call, args: { ...call.args, view: nutrients && !preparation ? "nutrition" : "recipe" } }));

  const results: SuggestedCall[] = [];
  const visualRequest = /\b(chart|graph|plot|visuali[sz]e|visualisation|visualization)\b/u.test(text)
    || /\b(show|display|draw)\b.{0,60}\b(trend|compar(?:e[sd]?|ison)|breakdown)\b/u.test(text);
  const visualization = visualRequest && /\bweight\b/u.test(text) ? "line"
    : visualRequest && /\b(macros?|macronutrients?|breakdown)\b/u.test(text) ? "pie"
      : visualRequest && /\bprotein\b/u.test(text) ? "bar" : undefined;
  const trend = /\b(trend|changed?|progress|plateau|history|historical|lost|gained|improving)\b/u.test(text)
    || /\b(weight|fitness|wellness|activity)\b/u.test(text) && (/\b(week|month)\b/u.test(text) || visualRequest);
  const target = /\b(goals?|target weight|my target|how close|preferences|restrictions|my name)\b/u.test(text)
    && !(/\b(protein|calories|carbohydrates?|carbs?|fat|macros?|macronutrients?)\b/u.test(text) && /\btarget\b/u.test(text));
  const explicitHealthTrend = /\b(weight|bmi|wellness|score|activity|fitness)\b/u.test(text);
  if (trend && (nutrients || followUp && previous?.topic === "nutrition" && !explicitHealthTrend)) {
    results.push({ name: "get_nutrition_intake", args: { period: period === "today" ? previous?.period ?? "week" : period, view: "trend", ...(visualization === "bar" || visualization === "pie" ? { visualization } : {}) } });
  } else if (trend && !/how close/u.test(text)) {
    const metric = /\b(activity|fitness|active)\b/u.test(text) ? "activity" : /\bbmi\b/u.test(text) ? "bmi" : /\b(wellness|score)\b/u.test(text) ? "wellness_score" : followUp && previous?.metrics?.includes("bmi") && !previous.metrics.includes("weight") ? "bmi" : "weight";
    results.push({ name: "get_health_progress", args: { metric, period: period === "today" ? "month" : period, ...(visualization === "line" ? { visualization } : {}) } });
  } else {
    const metrics: string[] = [];
    if (/\bweight\b/u.test(text) && !/target weight|how close/u.test(text)) metrics.push("weight");
    if (/\bbmi\b/u.test(text)) metrics.push("bmi");
    if (/\b(wellness|score)\b/u.test(text)) metrics.push("wellness_score");
    if (/\bactivity\b/u.test(text)) metrics.push("activity");
    if (/\bheight\b/u.test(text)) metrics.push("height");
    if (/\bfitness level\b/u.test(text)) metrics.push("fitness");
    if (/\b(metrics|measurements|health profile)\b/u.test(text) && !metrics.length) metrics.push("weight", "bmi", "wellness_score", "activity", "height", "fitness");
    if (metrics.length) results.push({ name: "get_health_metrics", args: { metrics, ...(explicitDate ? { date: explicitDate } : {}) } });
  }
  if (target) results.push({ name: "get_health_goals", args: {} });
  if (/\b(meal plans?|planned meals?|lunch|dinner|breakfast|on my menu)\b/u.test(text) && !preparation) {
    if (/\b(this|next) week\b/u.test(text) && !explicitDate) {
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
      date = shiftDate(today, -(weekday === 0 ? 6 : weekday - 1) + (text.includes("next week") ? 7 : 0));
    }
    results.push({ name: "get_meal_plan", args: { date, days: /\bweek\b/u.test(text) ? 7 : 1, ...(explicitMeal ? { mealType: explicitMeal } : {}) } });
  }
  if (nutrients && !results.some((call) => call.name === "get_nutrition_intake")) results.push({ name: "get_nutrition_intake", args: { period, ...(visualization === "bar" || visualization === "pie" ? { visualization } : {}) } });
  const wellnessTopic = /\bsleep|bedtime|insomnia/u.test(text) ? "sleep" : /\bstretch/u.test(text) ? "stretching"
    : /\bhydrat|\bwater\b|\bfluids\b/u.test(text) ? "hydration" : /\bstress|relax|anxious/u.test(text) ? "stress"
      : /\bexercise|\bworkout|\bmove more/u.test(text) && !trend && !target ? "activity" : undefined;
  if (wellnessTopic) results.push({ name: "get_wellness_guidance", args: { topic: wellnessTopic } });
  if (!results.length && followUp && previous) return referenceCall(previous);
  return results.slice(0, 4);
}

export function requestIsInScope(message: string, calls: SuggestedCall[]): boolean {
  return calls.length > 0 || /\b(health|wellness|wellbeing|diet|food|meal|recipe|sleep|fitness|protein|nutrition|exercise|calories)\b/iu.test(message);
}
