import { memo, useEffect, useRef } from "react";

export const Metric = memo(function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="metric-row">
      <div><span className="metric-label">{label}</span><span className="metric-detail">{detail}</span></div>
      <strong>{value}</strong>
    </div>
  );
});

export const ProgressValue = memo(function ProgressValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="progress-value">
      <div className="progress-label"><span>{label}</span><strong>{value}/100</strong></div>
      <div className="progress-track" role="img" aria-label={`${label}: ${value} out of 100`}>
        <span style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} />
      </div>
    </div>
  );
});

export const WellnessGauge = memo(function WellnessGauge({ value }: { value: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
      const centreX = width / 2;
      const centreY = height / 2;
      const radius = Math.max(1, Math.min(width, height) / 2 - 8);
      const start = -Math.PI / 2;
      const end = start + Math.PI * 2 * Math.max(0, Math.min(value, 100)) / 100;
      context.lineWidth = 14;
      context.lineCap = "butt";
      context.strokeStyle = "#414d48";
      context.beginPath();
      context.arc(centreX, centreY, radius, 0, Math.PI * 2);
      context.stroke();
      const scoreGradient = context.createLinearGradient(0, 0, width, height);
      scoreGradient.addColorStop(0, "#b96964");
      scoreGradient.addColorStop(0.55, "#c09562");
      scoreGradient.addColorStop(1, "#6f998e");
      context.strokeStyle = scoreGradient;
      context.beginPath();
      context.arc(centreX, centreY, radius, start, end);
      context.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div className="score-gauge" role="img" aria-label={`Wellness score ${value} out of 100`}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="score-gauge-centre"><strong>{value}</strong><span className="score-scale">0 to 100</span></div>
    </div>
  );
});

export const WeightTrendLine = memo(function WeightTrendLine({ records, minimum, span }: { records: Array<{ weightKg: number }>; minimum: number; span: number }) {
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
      context.strokeStyle = "#a3c5bc";
      context.fillStyle = "#a3c5bc";
      context.lineWidth = 2;
      context.beginPath();
      records.forEach((record, index) => {
        const x = records.length === 1 ? width / 2 : (index / (records.length - 1)) * width;
        const y = records.length === 1 ? height / 2 : height - ((record.weightKg - minimum) / span) * height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      if (records.length === 1) {
        context.beginPath();
        context.arc(width / 2, height / 2, 3, 0, Math.PI * 2);
        context.fill();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [records, minimum, span]);

  return <canvas className="weight-line" ref={canvasRef} aria-hidden="true" />;
});
