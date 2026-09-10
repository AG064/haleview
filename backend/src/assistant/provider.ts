import { getDeepSeekConfig } from "../deepseek.js";
import { assistantTools } from "./tools.js";
import { isRecord, type ChatProvider, type ToolCall } from "./types.js";

export function createChatProvider(fetchImpl: typeof fetch = fetch): ChatProvider | null {
  const config = getDeepSeekConfig();
  if (!config) return null;
  return {
    async complete(messages, allowTools, signal, requireTools = false) {
      const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          thinking: { type: "disabled" },
          temperature: 0.2,
          top_p: 1,
          max_tokens: 900,
          response_format: { type: "json_object" },
          messages,
          ...(allowTools ? { tools: assistantTools, tool_choice: requireTools ? "required" : "auto" } : {}),
        }),
        signal,
      });
      if (!response.ok) throw new Error("Chat provider is unavailable.");
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body.choices) || !isRecord(body.choices[0]) || body.choices[0].finish_reason === "length") {
        throw new Error("Chat provider returned an incomplete response.");
      }
      const message = body.choices[0].message;
      if (!isRecord(message)) throw new Error("Chat response is missing.");
      const toolCalls: ToolCall[] = [];
      if (message.tool_calls !== undefined) {
        if (!allowTools || !Array.isArray(message.tool_calls) || message.tool_calls.length > 4) throw new Error("Too many chat tool calls.");
        for (const call of message.tool_calls) {
          if (!isRecord(call) || typeof call.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/u.test(call.id)
            || call.type !== "function" || !isRecord(call.function) || typeof call.function.name !== "string"
            || call.function.name.length > 80 || typeof call.function.arguments !== "string" || call.function.arguments.length > 1000
            || toolCalls.some((previous) => previous.id === call.id)) throw new Error("Invalid chat tool call.");
          toolCalls.push({ id: call.id, type: "function", function: { name: call.function.name, arguments: call.function.arguments } });
        }
      }
      const content = message.content === null || message.content === undefined ? null : message.content;
      if (content !== null && (typeof content !== "string" || content.length > 6000)) throw new Error("Chat reply is too long.");
      if (!content && !toolCalls.length) throw new Error("Chat reply is empty.");
      const tokens = isRecord(body.usage) && typeof body.usage.total_tokens === "number" && Number.isSafeInteger(body.usage.total_tokens)
        && body.usage.total_tokens >= 0 ? body.usage.total_tokens : 0;
      return { content, toolCalls, tokens };
    },
  };
}
