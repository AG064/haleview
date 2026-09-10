import type { HealthProfile } from "./types";

export function asNumber(value: string): number {
  return value === "" ? 0 : Number(value);
}

export function localDateTimeValue(date = new Date()): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

export function displayDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

export function formatClassification(value: HealthProfile["analytics"]["bmiClassification"]): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
