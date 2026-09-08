import type { HealthProfile } from "./types";

export function asNumber(value: string): number {
  return value === "" ? 0 : Number(value);
}

export function localDateTimeValue(date = new Date(), timezone?: string): string {
  if (timezone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  }
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

export function displayDate(value: string, timezone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (!timezone) return date.toISOString();
  const local = localDateTimeValue(date, timezone);
  const offset = Math.round((Date.parse(`${local}:00Z`) - Math.floor(date.getTime() / 60000) * 60000) / 60000);
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  return `${local}:${String(date.getUTCSeconds()).padStart(2, "0")}${offset < 0 ? "-" : "+"}${hours}:${minutes}`;
}

export function displayDateOnly(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

export function displayShortDate(value: string | Date): string {
  return displayDateOnly(value);
}

export function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

export function sentenceLabel(value: string): string {
  if (value === "fodmap_friendly") return "FODMAP friendly";
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatClassification(value: HealthProfile["analytics"]["bmiClassification"]): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
