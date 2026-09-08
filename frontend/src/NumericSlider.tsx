import { useId, useState } from "react";

interface NumericSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  showSlider?: boolean;
  onChange: (value: number) => void;
  onValidityChange?: (error: string | null) => void;
}

export default function NumericSlider({ label, value, min, max, step = 1, unit, showSlider = true, onChange, onValidityChange }: NumericSliderProps) {
  const labelId = useId();
  const errorId = useId();
  const inputId = useId();
  const unitId = useId();
  const [edit, setEdit] = useState({ source: value, draft: String(value) });
  const [fieldError, setFieldError] = useState<string | null>(null);
  const draft = edit.source === value ? edit.draft : String(value);

  const validateDraft = (text: string): string | null => {
    const parsed = Number(text);
    if (text === "" || !Number.isFinite(parsed)) return "Enter a value.";
    if (parsed < min || parsed > max) return `Enter a value from ${min} to ${max}.`;
    const steps = (parsed - min) / step;
    if (Math.abs(steps - Math.round(steps)) > 0.000001) return step === 1 ? "Enter a whole number." : `Use steps of ${step}.`;
    return null;
  };

  const acceptDraft = (text: string) => {
    setEdit({ source: value, draft: text });
    const parsed = Number(text);
    const nextError = validateDraft(text);
    setFieldError(nextError);
    onValidityChange?.(nextError);
    if (!nextError) {
      onChange(parsed);
    }
  };

  const finishDraft = () => {
    const parsed = Number(draft);
    const nextError = validateDraft(draft);
    setFieldError(nextError);
    onValidityChange?.(nextError);
    if (nextError) return;
    onChange(parsed);
    setEdit({ source: parsed, draft: String(parsed) });
  };

  const numberInput = <input
    id={inputId}
    className={showSlider ? "slider-number-input" : "profile-number-input"}
    type="number"
    inputMode={step === 1 ? "numeric" : "decimal"}
    min={min}
    max={max}
    step={step}
    value={draft}
    aria-label={`${label} value`}
    aria-invalid={Boolean(fieldError)}
    aria-describedby={`${unitId}${fieldError ? ` ${errorId}` : ""}`}
    onChange={(event) => acceptDraft(event.target.value)}
    onBlur={finishDraft}
  />;

  if (!showSlider) return <div className="profile-number-field">
    <label htmlFor={inputId}>{label}</label>
    <div className="profile-number-control">{numberInput}<span id={unitId}>{unit}</span></div>
    {fieldError && <span className="field-error" id={errorId} role="alert">{fieldError}</span>}
  </div>;

  return (
    <div className="slider-field" role="group" aria-labelledby={labelId}>
      <div className="slider-heading">
        <span id={labelId}>{label}</span>
        <span className="slider-value">
          {numberInput}
          <span id={unitId}>{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.max(min, Math.min(max, value))}
        aria-label={`${label} slider`}
        onChange={(event) => {
          const next = Number(event.target.value);
          setEdit({ source: next, draft: step < 1 ? next.toFixed(String(step).split(".")[1]?.length ?? 0) : String(next) });
          setFieldError(null);
          onValidityChange?.(null);
          onChange(next);
        }}
      />
      <div className="slider-limits"><span>{min} {unit}</span><span>{max} {unit}</span></div>
      {fieldError && <span className="field-error" id={errorId} role="alert">{fieldError}</span>}
    </div>
  );
}
