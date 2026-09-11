import { ApiError } from "./api";

export interface ChatTurn {
  id: string;
  message: string;
  createdAt: string;
  mode?: "concise" | "detailed";
  reply: {
    text: string;
    sections: ChatSection[];
    source: "deepseek" | "local";
    notice: string | null;
    suggestions?: Array<{ label: string; prompt: string }>;
  };
}

export interface ChatChart {
  type: "line" | "bar" | "pie";
  title: string;
  unit: string;
  description: string;
  items: Array<{ label: string; value: number; detail?: string }>;
}

export interface ChatSection {
  title: string;
  lines: string[];
  ordered?: boolean;
  kind?: string;
  chart?: ChatChart;
}

async function chatRequest<T>(token: string, method = "GET", body?: unknown, before?: string): Promise<T> {
  const response = await fetch(`/api/assistant${before ? `?before=${encodeURIComponent(before)}` : ""}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(response.status, result?.error ?? "Chat could not complete this request. Please try again.");
  }
  return response.json() as Promise<T>;
}

interface ChatPage { turns: ChatTurn[]; online: boolean; hasEarlier: boolean }
export const loadChat = (token: string) => chatRequest<ChatPage>(token);
export const loadEarlierChat = (before: string, token: string) => chatRequest<ChatPage>(token, "GET", undefined, before);
export const sendChat = (message: string, requestId: string, token: string, mode: "concise" | "detailed" = "concise") => chatRequest<{ turn: ChatTurn }>(token, "POST", { message, requestId, mode });
export const clearChat = (token: string) => chatRequest<{ message: string }>(token, "DELETE");
