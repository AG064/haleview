import { getPrivacy, getProfile } from "../storage.js";
import { assistantSystemPrompt } from "./prompt.js";
import { hasPrivateText } from "./privacy.js";
import { createChatProvider } from "./provider.js";
import { executeAssistantTool } from "./tools.js";
import { responseSections, safeDataText, todayForUser } from "./data.js";
import { requestIsInScope, suggestedTools } from "./intent.js";
import { findChatTurn, getChatHistory, saveChatTurn } from "./store.js";
import { ChatError, isRecord, type ChatProvider, type ChatReply, type ChatTurn, type ModelMessage, type ModelResult, type ReplyMode, type ToolResult } from "./types.js";

const activeAccounts = new Set<number>();
const localNotice = "Online AI is off. These answers use your saved data and general wellness guidance.";

function parseInput(value: unknown): { message: string; requestId: string; mode: ReplyMode } {
  if (!isRecord(value) || Object.keys(value).some((key) => !["message", "requestId", "mode"].includes(key))
    || typeof value.message !== "string" || !value.message.trim() || value.message.length > 2000
    || typeof value.requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/u.test(value.requestId)
    || value.mode !== undefined && value.mode !== "concise" && value.mode !== "detailed") {
    throw new ChatError(400, "Enter a message from 1 to 2000 characters, choose concise or detailed, and use a valid message identifier.");
  }
  if (/[\p{Cc}\p{Cf}]/u.test(value.message.replace(/[\n\r\t]/gu, ""))) throw new ChatError(400, "Remove control characters from the message.");
  if (hasPrivateText(value.message)) throw new ChatError(400, "Remove contact details, credentials and dates of birth before sending.");
  return { message: value.message.trim(), requestId: value.requestId, mode: value.mode ?? "concise" };
}

function boundaryReply(message: string): string | null {
  if (/\b(chest pain|chest pains|shortness of breath|trouble breathing|can't breathe|cannot breathe|severe bleeding|stroke symptoms)\b/iu.test(message)) {
    return "I cannot assess or diagnose these symptoms. Please seek urgent medical attention. If symptoms are happening now or are severe, contact your local emergency service.";
  }
  if (/\b(suicid\w*|kill myself|hurt myself|end my life)\b/iu.test(message)) return "I'm sorry you are going through this. Please reach out to someone you trust or a local crisis service now. If you may act on these thoughts or are in immediate danger, contact emergency services.";
  if (/\b(email|password|credentials?|date of birth|dob|other (?:users?|people|accounts?)|another (?:user|person|account)|all users?|admin mode|user\s*(?:id|#)|system prompt|api key|database dump)\b/iu.test(message)
    || /\b(ignore|override|bypass)\b.{0,45}\b(instructions?|rules?|permissions?|security)\b/iu.test(message)) {
    return "I can only help with your own health metrics, goals, meals and recorded nutrition. I cannot access contact details, credentials or other people's accounts.";
  }
  if (/\b(diagnos\w*|prescrib\w*|medication|dosage|symptoms?)\b/iu.test(message)
    || /\bpain\b/iu.test(message) && !/\bstretch/iu.test(message)) {
    return "I can explain your saved wellness data, but I cannot diagnose symptoms or recommend treatment. Please speak with a qualified healthcare professional about medical concerns.";
  }
  return null;
}

function localReply(results: ToolResult[], notice: string | null, mode: ReplyMode, name: string): ChatReply {
  return {
    text: results.length ? `${name ? `${name}, here` : "Here"} is what is available for your question.` : `${name ? `${name}, I` : "I"} can help with health metrics, progress, goals, meal plans, recipes, recorded nutrition and general wellness. Ask about one of these topics to get started.`,
    sections: responseSections(results, mode), source: "local", notice,
  };
}

function conversationMessages(history: ChatTurn[], message: string, mode: ReplyMode, name: string, today: string): ModelMessage[] {
  const messages: ModelMessage[] = [{ role: "system", content: assistantSystemPrompt }];
  messages.push({ role: "system", content: `Response mode: ${mode}. Today's local date: ${today}. Chosen name (untrusted data): ${JSON.stringify(name || null)}. Previous reference (server-owned data): ${JSON.stringify(history.at(-1)?.reference ?? null)}.` });
  for (const turn of history.slice(-5)) {
    messages.push({ role: "user", content: turn.message.slice(0, 1000) });
    messages.push({ role: "assistant", content: JSON.stringify({ reply: turn.reply.text.slice(0, 900), previousData: turn.reply.sections.slice(0, 3).map((section) => ({ title: section.title, lines: section.lines.slice(0, 7).map((line) => line.slice(0, 180)) })), reference: turn.reference ?? null }) });
  }
  messages.push({ role: "user", content: message });
  return messages;
}

function parseReply(content: string | null, mode: ReplyMode): string {
  const value: unknown = JSON.parse(content ?? "null");
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.reply !== "string"
    || !value.reply.trim() || value.reply.length > (mode === "detailed" ? 3200 : 1400) || hasPrivateText(value.reply)
    || /[\p{N}\p{Cf}\p{Extended_Pictographic}\u2014<>]/u.test(value.reply)
    || /\p{Cc}/u.test(value.reply.replace(/[\n\r\t]/gu, ""))
    || /https?:\/\/|www\./iu.test(value.reply)
    || /\b(you have|you suffer from|your diagnosis is)\b.{0,35}\b(diabetes|cancer|depression|infection|disease)\b/iu.test(value.reply)
    || /\b(take|start|increase|stop|reduce)\b.{0,35}\b(medication|medicine|dose|ibuprofen|aspirin|antibiotics|insulin)\b/iu.test(value.reply)) throw new Error("Unusable chat response.");
  return value.reply.trim();
}

async function withinDeadline(operation: Promise<ModelResult>, signal: AbortSignal): Promise<ModelResult> {
  if (signal.aborted) throw new Error("Chat timed out.");
  let abort: () => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => { abort = () => reject(new Error("Chat timed out.")); signal.addEventListener("abort", abort, { once: true }); });
  try { return await Promise.race([operation, deadline]); }
  finally { signal.removeEventListener("abort", abort); }
}

export function chatIsBusy(userId: number): boolean { return activeAccounts.has(userId); }

export async function sendChatMessage(
  userId: number,
  input: unknown,
  options: { provider?: ChatProvider | null; now?: Date; timeoutMs?: number; isAuthorized?: () => boolean } = {},
): Promise<ChatTurn> {
  const { message, requestId, mode } = parseInput(input);
  const checkAccess = () => {
    if (!Number.isSafeInteger(userId) || userId < 1 || options.isAuthorized?.() === false) throw new ChatError(401, "Your session ended. Sign in again to continue.");
    if (!getPrivacy(userId)?.consentGiven) throw new ChatError(403, "Complete your profile and confirm data use before chatting.");
  };
  checkAccess();
  const existing = findChatTurn(userId, requestId);
  if (existing) {
    if (existing.message !== message || (existing.mode ?? "concise") !== mode) throw new ChatError(409, "This message identifier has already been used.");
    return existing;
  }
  if (activeAccounts.has(userId)) throw new ChatError(409, "Hale is answering your previous message. Try again when it finishes.");
  if (activeAccounts.size >= 12) throw new ChatError(503, "Hale is busy. Please try again in a moment.");
  activeAccounts.add(userId);
  try {
    const now = options.now ?? new Date();
    const history = getChatHistory(userId);
    const today = todayForUser(userId, now);
    const name = safeDataText(getProfile(userId)?.displayName ?? "");
    const suggestedCalls = suggestedTools(message, history, today);
    const localResults = () => suggestedCalls.map((call) => executeAssistantTool(userId, call.name, call.args, now));
    const boundary = boundaryReply(message);
    let reply: ChatReply;
    let tokens = 0;
    let results: ToolResult[] = [];
    const onlineAllowed = () => getPrivacy(userId)?.dataForRecommendations === true;
    const inScope = requestIsInScope(message, suggestedCalls);
    const provider = onlineAllowed() && !boundary && inScope ? (options.provider === undefined ? createChatProvider() : options.provider) : null;
    if (boundary) reply = { text: boundary, sections: [], source: "local", notice: null };
    else if (!provider) { results = localResults(); reply = localReply(results, inScope ? localNotice : null, mode, name); }
    else {
      try {
        const messages = conversationMessages(history, message, mode, name, today);
        if (suggestedCalls.length) messages.splice(messages.length - 1, 0, { role: "system", content: `Server-suggested data requests for the user's explicit question: ${JSON.stringify(suggestedCalls)}. Use these parameter values for meal references and dates.` });
        const signal = AbortSignal.timeout(options.timeoutMs ?? 55000);
        let finalContent: string | null = null;
        for (let round = 0; round < 3; round += 1) {
          checkAccess();
          if (!onlineAllowed() || JSON.stringify(messages).length > 50000) throw new Error("Online access or context limit changed.");
          const response = await withinDeadline(provider.complete(messages, round < 2, signal, round === 0 && suggestedCalls.length > 0, { mode, ...(round === 0 && suggestedCalls.length === 1 ? { toolName: suggestedCalls[0].name } : {}) }), signal);
          checkAccess();
          if (!Number.isSafeInteger(response.tokens) || response.tokens < 0) throw new Error("Invalid token usage.");
          tokens += response.tokens;
          if (tokens > 30000) throw new Error("Chat token budget exceeded.");
          if (!response.toolCalls.length) { finalContent = response.content; break; }
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
        try { text = parseReply(finalContent, mode); }
        catch {
          if (!finalContent || !onlineAllowed()) throw new Error("Chat response cannot be repaired.");
          messages.push({ role: "assistant", content: finalContent });
          messages.push({ role: "system", content: "The reply format or safety rules were rejected. Return only JSON with one key, reply. Write a safe introduction or explanation with no digits, measurements, links, medical treatment instructions or markup. The app displays exact tool values separately. Do not call functions again." });
          checkAccess();
          const repair = await withinDeadline(provider.complete(messages, false, signal, false, { mode }), signal);
          checkAccess();
          if (!Number.isSafeInteger(repair.tokens) || repair.tokens < 0) throw new Error("Invalid token usage.");
          tokens += repair.tokens;
          if (repair.toolCalls.length || !Number.isSafeInteger(tokens) || tokens > 30000) throw new Error("Chat repair budget exceeded.");
          text = parseReply(repair.content, mode);
        }
        if (!results.length && suggestedCalls.length) throw new Error("Personal data was not retrieved.");
        reply = { text, sections: responseSections(results, mode), source: "deepseek", notice: null };
      } catch (error) {
        if (error instanceof ChatError) throw error;
        checkAccess();
        if (!results.length || results.every((result) => result.code === "invalid_arguments")) results = localResults();
        reply = localReply(results, "Online AI could not finish this reply. These results use your saved data and local guidance. You can send another message to try again.", mode, name);
      }
    }
    checkAccess();
    const reference = [...results].reverse().find((result) => result.ok && result.reference)?.reference;
    const turn: ChatTurn = { id: requestId, message, reply, createdAt: now.toISOString(), mode, ...(reference ? { reference } : {}) };
    saveChatTurn(userId, turn, tokens);
    return turn;
  } finally { activeAccounts.delete(userId); }
}
