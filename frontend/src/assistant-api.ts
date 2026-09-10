import { ApiError } from "./api";

export interface ChatTurn {
  id: string;
  message: string;
  createdAt: string;
  mode?: "concise" | "detailed";
  reply: {
    text: string;
    sections: Array<{ title: string; lines: string[]; ordered?: boolean; kind?: string }>;
    source: "deepseek" | "local";
    notice: string | null;
  };
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
