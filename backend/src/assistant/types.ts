export interface ChatSection {
  title: string;
  lines: string[];
}

export interface ChatReply {
  text: string;
  sections: ChatSection[];
  source: "deepseek" | "local";
  notice: string | null;
}

export interface ChatTurn {
  id: string;
  message: string;
  reply: ChatReply;
  createdAt: string;
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
  complete(messages: ModelMessage[], allowTools: boolean, signal: AbortSignal, requireTools?: boolean): Promise<ModelResult>;
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
