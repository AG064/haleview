import { Sparkles, UtensilsCrossed } from "lucide-react";
import type { NutritionAdvice, NutritionProgressResult } from "../nutrition/types";

export function NutritionInsights({ progress, advice, allowOnlineAi, busy, message, onReview }: {
  progress: NutritionProgressResult | null;
  advice: NutritionAdvice | null | undefined;
  allowOnlineAi: boolean;
  busy: boolean;
  message: string | null;
  onReview: () => void;
}) {
  if (!progress) return <p className="muted-text" role="status">{message || "Loading nutrition insights..."}</p>;
  if (progress.today.recordCount === 0) return <div className="nutrition-insights-empty">
    <UtensilsCrossed aria-hidden="true" />
    <div><h3>No daily comparison yet</h3><p>Record a meal in Nutrition to compare today's intake with your targets. Then Hale can help you choose what to focus on next.</p><a className="text-button" href="/nutrition">Open Nutrition</a></div>
  </div>;
  const online = advice?.source === "deepseek";
  return <div className="nutrition-insights-content">
    <section className="nutrition-calculated" aria-label="Calculated nutrition facts">
      <p className="eyebrow">Calculated by Haleview</p>
      <h3>Today's nutrition</h3>
      <p>{progress.summary.text}</p>
      <p className="nutrition-wellness">Wellness with recorded nutrition <strong>{progress.wellnessScore} / 100</strong></p>
    </section>
    <section className={`nutrition-suggestions${online ? " is-online" : ""}`} aria-label="Nutrition suggestions">
      <div className="nutrition-suggestions-heading"><Sparkles aria-hidden="true" /><div><p className="eyebrow">{online ? "Suggestions selected by DeepSeek" : "Haleview suggestions"}</p><h3>What to focus on next</h3></div></div>
      {online && <p className="nutrition-source-note">AI prioritizes the suggestions below using your records. The figures above come from Haleview's calculations.</p>}
      {advice?.suggestions.length ? <ul>{advice.suggestions.map(suggestion => <li key={suggestion}>{suggestion}</li>)}</ul> : <p>No suggestions are available for these records yet.</p>}
      {allowOnlineAi && <button className="secondary-button" type="button" disabled={busy} aria-busy={busy} onClick={onReview}>{busy ? "Reviewing nutrition..." : "Review nutrition with online AI"}</button>}
      {message && <p className="nutrition-review-message" role="status">{message}</p>}
    </section>
  </div>;
}
