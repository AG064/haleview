import type { NutritionTrendPoint } from "../nutrition/types";

interface NutritionTrendsProps {
  points: NutritionTrendPoint[];
}

function linePoints(values: number[], maximum: number): string {
  if (values.length === 0) return "";
  return values.map((value, index) => {
    const x = values.length === 1 ? 50 : index / (values.length - 1) * 100;
    const y = 92 - Math.min(1, value / maximum) * 82;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function TrendChart({ title, points }: { title: string; points: NutritionTrendPoint[] }) {
  const maximum = Math.max(1, ...points.flatMap((point) => [point.caloriesKcal, point.calorieTargetKcal]));
  const calories = linePoints(points.map((point) => point.caloriesKcal), maximum);
  const targets = linePoints(points.map((point) => point.calorieTargetKcal), maximum);
  const macroMaximum = Math.max(1, ...points.flatMap((point) => [point.proteinG, point.carbsG, point.fatsG]));
  return (
    <div className="nutrition-trend-card">
      <div className="trend-card-heading"><h4>{title}</h4><span>{points.length} days</span></div>
      <svg className="nutrition-line-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${title} calorie intake and target`}>
        <line x1="0" y1="92" x2="100" y2="92" className="chart-axis" />
        <polyline points={targets} className="target-line-path" />
        <polyline points={calories} className="calorie-line-path" />
      </svg>
      <div className="chart-key"><span className="key-calories">Calories</span><span className="key-target">Target</span></div>
      <div className="macro-spark" aria-label={`${title} macro totals`}>
        {points.map((point) => (
          <span className="macro-day" key={point.date} title={`${point.date}: ${Math.round(point.proteinG)} g protein, ${Math.round(point.carbsG)} g carbohydrate, ${Math.round(point.fatsG)} g fat`}>
            <i className="macro-protein" style={{ height: `${point.proteinG / macroMaximum * 100}%` }} />
            <i className="macro-carbs" style={{ height: `${point.carbsG / macroMaximum * 100}%` }} />
            <i className="macro-fat" style={{ height: `${point.fatsG / macroMaximum * 100}%` }} />
          </span>
        ))}
      </div>
      <div className="chart-key"><span className="key-protein">Protein</span><span className="key-carbs">Carbohydrate</span><span className="key-fat">Fat</span></div>
    </div>
  );
}

export function NutritionTrends({ points }: NutritionTrendsProps) {
  return (
    <div className="nutrition-trend-grid">
      <TrendChart title="Last 7 days" points={points.slice(-7)} />
      <TrendChart title="Last 30 days" points={points.slice(-30)} />
    </div>
  );
}
