import type { Guidance } from "./types";

export function withoutGoalPrefix(value: string): string {
  return value.replace(/^Goal:\s*[^.]+\.\s*/u, "").trim();
}

export function guidanceContext(guidance: Guidance): string {
  return `I prepared these recommendations for your ${guidance.goal.toLowerCase()} goal. I used your current metrics and recent records.`;
}
