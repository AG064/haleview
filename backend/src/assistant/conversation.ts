import { getPrivacy } from "../storage.js";
import { assistantSystemPrompt } from "./prompt.js";
import { hasPrivateText } from "./privacy.js";
import { createChatProvider } from "./provider.js";
import { executeAssistantTool } from "./tools.js";
import { findChatTurn, getChatHistory, saveChatTurn } from "./store.js";
import { ChatError, isRecord, type ChatProvider, type ChatReply, type ChatTurn, type ModelMessage, type ToolResult } from "./types.js";

const activeAccounts = new Set<number>();
const localNotice = "Online AI is off. Hale can still show your saved metrics, goals, meal plans and recorded nutrition.";

function parseInput(value: unknown): { message: string; requestId: string } {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "message" && key !== "requestId")
    || typeof value.message !== "string" || !value.message.trim() || value.message.length > 2000
    || typeof value.requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/u.test(value.requestId)) {
    throw new ChatError(400, "Enter a message from 1 to 2000 characters with a valid message identifier.");
  }
  if (/[\p{Cc}\p{Cf}]/u.test(value.message.replace(/[\n\r\t]/gu, ""))) throw new ChatError(400, "Remove control characters from the message.");
  if (hasPrivateText(value.message)) throw new ChatError(400, "Remove contact details, credentials and dates of birth before sending.");
  return { message: value.message.trim(), requestId: value.requestId };
}

function boundaryReply(message: string): string | null {
  if (/\b(chest pain|chest pains|shortness of breath|trouble breathing|can't breathe|cannot breathe)\b/iu.test(message)) {
    return "I cannot assess or diagnose these symptoms. Please seek urgent medical attention. If symptoms are happening now or are severe, contact your local emergency service.";
  }
  if (/\b(email|password|credentials?|date of birth|dob|other users?|another user|all users?|admin mode|user\s*(?:id|#)|system prompt|api key)\b/iu.test(message)) {
    return "I can only help with your own health metrics, goals, meals and recorded nutrition. I cannot access contact details, credentials or other people's accounts.";
  }
  if (/\b(diagnos\w*|prescrib\w*|medication|dosage|symptoms?|pain)\b/iu.test(message)) {
    return "I can explain your saved wellness data, but I cannot diagnose symptoms or recommend treatment. Please speak with a qualified healthcare professional about medical concerns.";
  }
  return null;
}

function localCalls(message: string, history: ChatTurn[]): Array<{ name: string; args: unknown }> {
  const text = message.toLowerCase();
  const results: Array<{ name: string; args: unknown }> = [];
  const metrics: string[] = [];
  if (/\bweight\b/u.test(text)) metrics.push("weight");
  if (/\bbmi\b/u.test(text)) metrics.push("bmi");
  if (/\b(wellness|score)\b/u.test(text)) metrics.push("wellness_score");
  if (/\bactivity\b/u.test(text)) metrics.push("activity");
  if (/\b(metrics|measurements)\b/u.test(text) && metrics.length === 0) metrics.push("weight", "bmi");
  if (metrics.length) results.push({ name: "get_health_metrics", args: { metrics } });
  if (/\b(goals?|target weight|my target|preferences|restrictions)\b/u.test(text)) results.push({ name: "get_health_goals", args: {} });
  if (/\b(meal plan|planned meals?|lunch|dinner|breakfast)\b/u.test(text)) {
    const date = text.match(/\d{4}-\d{2}-\d{2}/u)?.[0] ?? (text.includes("tomorrow") ? "tomorrow" : "today");
    results.push({ name: "get_meal_plan", args: { date } });
  }
  if (/\b(protein|calories|macros?|intake|eaten|consumed)\b/u.test(text)) {
    results.push({ name: "get_nutrition_intake", args: { period: text.includes("week") ? "week" : "today" } });
  }
  if (!results.length && /\b(that|those|more|again)\b/u.test(text) && history.length) {
    return localCalls(history[history.length - 1].message, []);
  }
  return results;
}

function localReply(results: ToolResult[], notice: string): ChatReply {
  return {
    text: results.length ? "Here is what is available in your saved data." : "Ask about your current weight and BMI, saved goals, a daily meal plan or recorded nutrition. Detailed recipe questions and historical trends are available in Recipes and Progress.",
    sections: results.map((item) => item.section), source: "local", notice,
  };
}

function conversationMessages(history: ChatTurn[], message: string): ModelMessage[] {
  const messages: ModelMessage[] = [{ role: "system", content: assistantSystemPrompt }];
  // Limit provider context independently of the larger history shown in the UI.
  for (const turn of history.slice(-5)) {
    messages.push({ role: "user", content: turn.message.slice(0, 1000) });
    messages.push({ role: "assistant", content: JSON.stringify({ reply: turn.reply.text, previousData: turn.reply.sections }).slice(0, 2200) });
  }
  messages.push({ role: "user", content: message });
  return messages;
}

function parseReply(content: string | null): string {
  const value: unknown = JSON.parse(content ?? "null");
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.reply !== "string"
    || !value.reply.trim() || value.reply.length > 1400 || hasPrivateText(value.reply)
    || /[\p{N}\p{Cf}\p{Extended_Pictographic}\u2014<>]/u.test(value.reply)
    || /\p{Cc}/u.test(value.reply.replace(/[\n\r\t]/gu, ""))
    || /https?:\/\/|www\./iu.test(value.reply)) throw new Error("Unusable chat response.");
  return value.reply.trim();
}

export function chatIsBusy(userId: number): boolean {
  return activeAccounts.has(userId);
}

export async function sendChatMessage(
  userId: number,
  input: unknown,
  options: { provider?: ChatProvider | null; now?: Date; timeoutMs?: number } = {},
): Promise<ChatTurn> {
  const { message, requestId } = parseInput(input);
  const existing = findChatTurn(userId, requestId);
  if (existing) {
    if (existing.message !== message) throw new ChatError(409, "This message identifier has already been used.");
    return existing;
  }
  if (activeAccounts.has(userId)) throw new ChatError(409, "Hale is answering your previous message. Try again when it finishes.");
  if (!getPrivacy(userId)?.consentGiven) throw new ChatError(403, "Complete your profile and confirm data use before chatting.");
  activeAccounts.add(userId);
  try {
    const now = options.now ?? new Date();
    const history = getChatHistory(userId);
    const suggestedCalls = localCalls(message, history);
    const localResults = () => suggestedCalls.map((call) => executeAssistantTool(userId, call.name, call.args, now));
    const boundary = boundaryReply(message);
    let reply: ChatReply;
    let tokens = 0;
    const onlineAllowed = () => getPrivacy(userId)?.dataForRecommendations === true;
    const provider = onlineAllowed() && !boundary ? (options.provider === undefined ? createChatProvider() : options.provider) : null;
    if (boundary) {
      reply = { text: boundary, sections: [], source: "local", notice: null };
    } else if (!provider) {
      reply = localReply(localResults(), localNotice);
    } else {
      const results: ToolResult[] = [];
      try {
        const messages = conversationMessages(history, message);
        const signal = AbortSignal.timeout(options.timeoutMs ?? 55000);
        let finalContent: string | null = null;
        for (let round = 0; round < 3; round += 1) {
          if (!onlineAllowed()) throw new Error("Online consent changed.");
          const response = await provider.complete(messages, round < 2, signal, round === 0 && suggestedCalls.length > 0);
          tokens += response.tokens;
          if (tokens > 30000) throw new Error("Chat token budget exceeded.");
          if (response.toolCalls.length === 0) { finalContent = response.content; break; }
          if (round === 2 || response.toolCalls.length > 4) throw new Error("Chat tool budget exceeded.");
          messages.push({ role: "assistant", content: response.content, tool_calls: response.toolCalls });
          for (const call of response.toolCalls) {
            let args: unknown;
            try { args = JSON.parse(call.function.arguments); } catch { args = null; }
            const result = executeAssistantTool(userId, call.function.name, args, now);
            results.push(result);
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
          }
        }
        let text: string;
        try {
          text = parseReply(finalContent);
        } catch {
          if (!finalContent || !onlineAllowed()) throw new Error("Chat response cannot be repaired.");
          messages.push({ role: "assistant", content: finalContent });
          messages.push({ role: "system", content: "The reply format was rejected. Return only JSON with one key, reply. Write a short introduction with no digits, measurements, links or markup. The app displays exact tool values separately. Do not call functions again." });
          const repair = await provider.complete(messages, false, signal);
          tokens += repair.tokens;
          if (repair.toolCalls.length || tokens > 30000) throw new Error("Chat repair budget exceeded.");
          text = parseReply(repair.content);
        }
        if (!results.length && suggestedCalls.length > 0) throw new Error("Personal data was not retrieved.");
        reply = { text, sections: results.map((result) => result.section), source: "deepseek", notice: null };
      } catch {
        reply = localReply(results.length ? results : localResults(), "Online AI could not finish this reply. These results come directly from your saved data. You can send another message to try again.");
      }
    }
    const turn: ChatTurn = { id: requestId, message, reply, createdAt: now.toISOString() };
    saveChatTurn(userId, turn, tokens);
    return turn;
  } finally {
    activeAccounts.delete(userId);
  }
}
