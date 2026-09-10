import { getNutritionPreferences } from "../nutrition/storage.js";
import { defaultTimezone } from "../timezone.js";
import { containsPersonalIdentifier } from "../profile.js";
import { hasPrivateText } from "./privacy.js";
import type { ChatSection, ReplyMode, ToolResult } from "./types.js";

export const mealTypes = ["breakfast", "lunch", "dinner", "snack"] as const;
export const metricNames = ["weight", "bmi", "wellness_score", "activity", "height", "fitness"] as const;

export function failed(code: ToolResult["code"], message: string): ToolResult {
  return { ok: false, code, section: { title: "Data unavailable", lines: [message] } };
}

export function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) throw new Error("Invalid numerical data.");
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits, useGrouping: false }).format(value);
}

export function safeDataText(value: string): string {
  if (typeof value !== "string" || value.length > 4000 || containsPersonalIdentifier(value) || hasPrivateText(value)
    || /[\p{Cc}\p{Cf}<>]/u.test(value.replace(/[\n\r\t]/gu, ""))) return "Not shared with chat";
  return value.replaceAll("_", " ");
}

export function dateInZone(date: Date, timezone: string): string {
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid saved date.");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function timezoneForUser(userId: number): string {
  return getNutritionPreferences(userId)?.timezone ?? defaultTimezone();
}

export function todayForUser(userId: number, now: Date): string {
  return dateInZone(now, timezoneForUser(userId));
}

export function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function resolveDate(value: string, today: string): string | null {
  if (value === "today") return today;
  if (value === "tomorrow") return shiftDate(today, 1);
  if (value === "yesterday") return shiftDate(today, -1);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function periodRange(today: string, period: string): { from: string; to: string } {
  if (period === "today") return { from: today, to: today };
  if (period === "week") return { from: shiftDate(today, -6), to: today };
  if (period === "last_month") {
    const to = shiftDate(`${today.slice(0, 7)}-01`, -1);
    return { from: `${to.slice(0, 7)}-01`, to };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function responseSections(results: ToolResult[], mode: ReplyMode): ChatSection[] {
  const sections = results.flatMap((result) => result.sections ?? [result.section]);
  const unique = new Set<string>();
  return sections.flatMap((section) => {
    const { details, ...base } = section;
    const formatted = { ...base, lines: [...base.lines, ...(mode === "detailed" ? (details ?? []).filter((line) => !base.lines.includes(line)) : [])] };
    const key = JSON.stringify(formatted);
    if (unique.has(key)) return [];
    unique.add(key);
    return [formatted];
  });
}
