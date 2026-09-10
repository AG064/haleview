import { memo, useEffect, useRef } from "react";
import type { AnalyticsHistoryRecord } from "../types";

const layers = [
  { key: "bmiScore", label: "BMI", weight: 0.3, color: "#8eaa90" },
  { key: "activityScore", label: "Activity", weight: 0.3, color: "#7997a0" },
  { key: "goalProgress", label: "Goal", weight: 0.2, color: "#c09562" },
  { key: "habitsScore", label: "Habits", weight: 0.2, color: "#9b7d6c" }
] as const;

function contribution(record: AnalyticsHistoryRecord, layer: typeof layers[number]): number {
  const stored = record[layer.key];
  const score = Number.isFinite(stored)
    ? stored
    : layer.key === "bmiScore"
      ? Math.round(Math.max(0, Math.min(100, 100 - Math.abs(record.bmi - 22) * 5)))
      : 0;
  return score * layer.weight;
}

export const WellnessHistoryChart = memo(function WellnessHistoryChart({ records }: { records: AnalyticsHistoryRecord[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || records.length === 0) return;
    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(scale, scale);
      context.clearRect(0, 0, width, height);
      const left = 12;
      const right = width - 12;
      const top = 10;
      const bottom = height - 18;
      const chartHeight = Math.max(1, bottom - top);
      const xAt = (index: number) => records.length === 1 ? width / 2 : left + index / (records.length - 1) * (right - left);
      const yAt = (value: number) => bottom - Math.max(0, Math.min(100, value)) / 100 * chartHeight;

      if (records.length === 1) {
        let total = 0;
        for (const layer of layers) {
          const amount = contribution(records[0], layer);
          context.fillStyle = layer.color;
          context.fillRect(width / 2 - 22, yAt(total + amount), 44, yAt(total) - yAt(total + amount));
          total += amount;
        }
      } else {
        let lower = records.map(() => 0);
        for (const layer of layers) {
          const upper = records.map((record, index) => lower[index] + contribution(record, layer));
          context.beginPath();
          upper.forEach((value, index) => index === 0 ? context.moveTo(xAt(index), yAt(value)) : context.lineTo(xAt(index), yAt(value)));
          for (let index = lower.length - 1; index >= 0; index -= 1) context.lineTo(xAt(index), yAt(lower[index]));
          context.closePath();
          context.fillStyle = layer.color;
          context.fill();
          lower = upper;
        }
      }

      context.beginPath();
      records.forEach((record, index) => index === 0
        ? context.moveTo(xAt(index), yAt(record.wellnessScore))
        : context.lineTo(xAt(index), yAt(record.wellnessScore)));
      context.strokeStyle = "#ebe4d8";
      context.lineWidth = 2;
      context.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [records]);

  return (
    <div className="wellness-history" role="img" aria-label="Wellness score and weighted component history">
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="wellness-legend">
        {layers.map((layer) => <span key={layer.key}><i style={{ backgroundColor: layer.color }} />{layer.label}</span>)}
        <span><i className="score-line-key" />Score</span>
      </div>
      <div className="wellness-dates" aria-hidden="true">
        <span>{new Date(records[0].recordedAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</span>
        {records.length > 1 && <span>{new Date(records[records.length - 1].recordedAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</span>}
      </div>
    </div>
  );
});
