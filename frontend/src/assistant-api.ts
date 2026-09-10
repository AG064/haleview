import { ApiError } from "./api";

export interface ChatTurn {
  id: string;
  message: string;
  createdAt: string;
  reply: {
    text: string;
    sections: Array<{ title: string; lines: string[] }>;
    source: "deepseek" | "local";
    notice: string | null;
  };
}

async function chatRequest<T>(token: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api/assistant", {
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

export const loadChat = (token: string) => chatRequest<{ turns: ChatTurn[]; online: boolean }>(token);
export const sendChat = (message: string, requestId: string, token: string) => chatRequest<{ turn: ChatTurn }>(token, "POST", { message, requestId });
export const clearChat = (token: string) => chatRequest<{ message: string }>(token, "DELETE");
