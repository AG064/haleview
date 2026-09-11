export interface ChatSection {
  title: string;
  lines: string[];
  details?: string[];
  ordered?: boolean;
  kind?: "metrics" | "progress" | "plan" | "recipe" | "nutrition" | "wellness";
  chart?: ChatChart;
}

export interface ChatChart {
  type: "line" | "bar" | "pie";
  title: string;
  unit: string;
  description: string;
  items: Array<{ label: string; value: number; detail?: string }>;
}

export interface ChatSuggestion {
  label: string;
  prompt: string;
}

export type ReplyMode = "concise" | "detailed";
export interface ChatReference {
  topic: "health" | "goals" | "progress" | "meal" | "recipe" | "nutrition" | "wellness";
  date?: string;
  mealType?: "breakfast" | "lunch" | "dinner" | "snack";
  recipeId?: string;
  servings?: number;
  period?: "today" | "week" | "month" | "last_month";
  metric?: "weight" | "bmi" | "wellness_score" | "activity";
  metrics?: Array<"weight" | "bmi" | "wellness_score" | "activity" | "height" | "fitness">;
  wellnessTopic?: "sleep" | "activity" | "stretching" | "hydration" | "stress";
  view?: "summary" | "trend" | "recipe" | "nutrition";
}

export interface ChatReply {
  text: string;
  sections: ChatSection[];
  source: "deepseek" | "local";
  notice: string | null;
  suggestions?: ChatSuggestion[];
}

export interface ChatTurn {
  id: string;
  message: string;
  reply: ChatReply;
  createdAt: string;
  mode?: ReplyMode;
  reference?: ChatReference;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolResult {
  ok: boolean;
  code?: "invalid_arguments" | "not_found" | "unavailable";
  section: ChatSection;
  sections?: ChatSection[];
  reference?: ChatReference;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ModelResult {
  content: string | null;
  toolCalls: ToolCall[];
  tokens: number;
}

export interface ChatProvider {
  complete(messages: ModelMessage[], allowTools: boolean, signal: AbortSignal, requireTools?: boolean, options?: { toolName?: string; mode?: ReplyMode }): Promise<ModelResult>;
}

export class ChatError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ChatError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
