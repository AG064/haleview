import type { Guidance } from "./types";

export function withoutGoalPrefix(value: string): string {
  return value.replace(/^Goal:\s*[^.]+\.\s*/u, "").trim();
}

export function guidanceContext(guidance: Guidance): string {
  return `These suggestions use your ${guidance.goal.toLowerCase()} goal, saved profile, and recent records.`;
}
