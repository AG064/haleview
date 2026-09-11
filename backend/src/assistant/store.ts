import { database } from "../storage.js";
import { protectStoredText, unprotectStoredText } from "../protected-data.js";
import { hasPrivateText } from "./privacy.js";
import { ChatError, isRecord, type ChatReference, type ChatTurn } from "./types.js";

database.exec(`
  CREATE TABLE IF NOT EXISTS assistant_turns (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    request_id TEXT NOT NULL,
    turn_json TEXT NOT NULL,
    tokens INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, request_id)
  );
  CREATE INDEX IF NOT EXISTS assistant_turns_user ON assistant_turns(user_id, sequence);
  CREATE TABLE IF NOT EXISTS assistant_context_summaries (
    user_id INTEGER PRIMARY KEY,
    through_sequence INTEGER NOT NULL,
    summary_json TEXT NOT NULL
  );
`);

export interface ContextTopic {
  topic: ChatReference["topic"];
  lastMessage: string;
  reference: ChatReference;
}

export interface ChatContextSummary {
  turnCount: number;
  notes: string[];
  topics: ContextTopic[];
}

interface SummaryRow { through_sequence: number; summary_json: string }
interface TurnRow { sequence: number; turn_json: string }

function emptySummary(): ChatContextSummary { return { turnCount: 0, notes: [], topics: [] }; }

function cleanContextText(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 180);
}

function conversationNotes(message: string): string[] {
  return message.split(/[.!?\n]+/u).map(cleanContextText).filter((part) =>
    !hasPrivateText(part) && /^(?:i (?:prefer|avoid|usually|do not|don't|cannot|can't)\b|my (?:goal|preference|routine)\b)/iu.test(part));
}

function addTurnsToSummary(summary: ChatContextSummary, rows: TurnRow[]): ChatContextSummary {
  const next: ChatContextSummary = {
    turnCount: summary.turnCount,
    notes: [...summary.notes],
    topics: summary.topics.map((topic) => ({ ...topic, reference: { ...topic.reference } })),
  };
  for (const row of rows) {
    let turn: ChatTurn;
    try { turn = JSON.parse(unprotectStoredText(row.turn_json)) as ChatTurn; }
    catch { continue; }
    next.turnCount += 1;
    for (const note of conversationNotes(turn.message)) {
      next.notes = next.notes.filter((existing) => existing.toLocaleLowerCase() !== note.toLocaleLowerCase());
      next.notes.push(note);
    }
    if (turn.reference) {
      next.topics = next.topics.filter((entry) => entry.topic !== turn.reference!.topic);
      next.topics.push({ topic: turn.reference.topic, lastMessage: cleanContextText(turn.message), reference: turn.reference });
    }
  }
  next.notes = next.notes.slice(-8);
  next.topics = next.topics.slice(-7);
  return next;
}

function readSummary(userId: number): { through: number; value: ChatContextSummary } {
  const row = database.prepare("SELECT through_sequence, summary_json FROM assistant_context_summaries WHERE user_id = ?").get(userId) as SummaryRow | undefined;
  if (!row) return { through: 0, value: emptySummary() };
  try {
    const value: unknown = JSON.parse(unprotectStoredText(row.summary_json));
    if (!isRecord(value) || typeof value.turnCount !== "number" || !Number.isSafeInteger(value.turnCount) || !Array.isArray(value.notes) || !Array.isArray(value.topics)) throw new Error("Invalid context summary.");
    return { through: row.through_sequence, value: value as unknown as ChatContextSummary };
  } catch { return { through: row.through_sequence, value: emptySummary() }; }
}

function advanceSummary(userId: number): { through: number; value: ChatContextSummary } {
  const current = readSummary(userId);
  const pending = database.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(tokens), 0) AS tokens, COALESCE(SUM(LENGTH(turn_json)), 0) AS chars FROM assistant_turns WHERE user_id = ? AND sequence > ?")
    .get(userId, current.through) as { count: number; tokens: number; chars: number };
  const remaining = pending.count;
  if (remaining < 10 && pending.tokens < 12000 && pending.chars < 24000) return current;
  const rows = database.prepare("SELECT sequence, turn_json FROM assistant_turns WHERE user_id = ? AND sequence > ? ORDER BY sequence LIMIT 33")
    .all(userId, current.through) as unknown as TurnRow[];
  const compactCount = Math.min(rows.length, Math.max(0, remaining - 6));
  if (!compactCount) return current;
  const compacted = rows.slice(0, compactCount);
  const value = addTurnsToSummary(current.value, compacted);
  const through = compacted.at(-1)!.sequence;
  database.prepare(`INSERT INTO assistant_context_summaries (user_id, through_sequence, summary_json) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET through_sequence = excluded.through_sequence, summary_json = excluded.summary_json`)
    .run(userId, through, protectStoredText(JSON.stringify(value)));
  return { through, value };
}

export function getModelChatContext(userId: number, activeTopics: ChatReference["topic"][]): { summary: ChatContextSummary; detailedTurns: ChatTurn[] } {
  const stored = advanceSummary(userId);
  const rows = database.prepare("SELECT sequence, turn_json FROM assistant_turns WHERE user_id = ? AND sequence > ? ORDER BY sequence DESC LIMIT 18")
    .all(userId, stored.through) as unknown as TurnRow[];
  rows.reverse();
  const turns = rows.map((row) => ({ row, turn: JSON.parse(unprotectStoredText(row.turn_json)) as ChatTurn }));
  const selected = new Set<number>();
  turns.slice(-2).forEach(({ row }) => selected.add(row.sequence));
  if (activeTopics.length) {
    for (let index = turns.length - 1; index >= 0 && selected.size < 5; index -= 1) {
      const item = turns[index];
      if (item.turn.reference && activeTopics.includes(item.turn.reference.topic)) selected.add(item.row.sequence);
    }
  } else {
    turns.slice(-5).forEach(({ row }) => selected.add(row.sequence));
  }
  const omitted = turns.filter(({ row }) => !selected.has(row.sequence)).map(({ row }) => row);
  return {
    summary: addTurnsToSummary(stored.value, omitted),
    detailedTurns: turns.filter(({ row }) => selected.has(row.sequence)).map(({ turn }) => turn),
  };
}

export function getChatHistory(userId: number): ChatTurn[] {
  return getChatPage(userId).turns;
}

export function getChatPage(userId: number, before?: string): { turns: ChatTurn[]; hasEarlier: boolean } {
  let sequence = Number.MAX_SAFE_INTEGER;
  if (before) {
    const row = database.prepare("SELECT sequence FROM assistant_turns WHERE user_id = ? AND request_id = ?").get(userId, before) as { sequence: number } | undefined;
    if (!row) throw new ChatError(404, "Earlier messages are not available for this conversation.");
    sequence = row.sequence;
  }
  const rows = database.prepare("SELECT turn_json FROM assistant_turns WHERE user_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT 41")
    .all(userId, sequence) as Array<{ turn_json: string }>;
  return { turns: rows.slice(0, 40).reverse().map((row) => JSON.parse(unprotectStoredText(row.turn_json)) as ChatTurn), hasEarlier: rows.length > 40 };
}

export function exportChatHistory(userId: number): ChatTurn[] {
  const rows = database.prepare("SELECT turn_json FROM assistant_turns WHERE user_id = ? ORDER BY sequence")
    .all(userId) as Array<{ turn_json: string }>;
  return rows.map((row) => JSON.parse(unprotectStoredText(row.turn_json)) as ChatTurn);
}

export function findChatTurn(userId: number, requestId: string): ChatTurn | null {
  const row = database.prepare("SELECT turn_json FROM assistant_turns WHERE user_id = ? AND request_id = ?")
    .get(userId, requestId) as { turn_json: string } | undefined;
  return row ? JSON.parse(unprotectStoredText(row.turn_json)) as ChatTurn : null;
}

export function saveChatTurn(userId: number, turn: ChatTurn, tokens: number): void {
  const previous = findChatTurn(userId, turn.id);
  if (previous) {
    if (previous.message !== turn.message || (previous.mode ?? "concise") !== (turn.mode ?? "concise")) throw new ChatError(409, "This message identifier has already been used.");
    return;
  }
  database.prepare("INSERT INTO assistant_turns (user_id, request_id, turn_json, tokens) VALUES (?, ?, ?, ?)")
    .run(userId, turn.id, protectStoredText(JSON.stringify(turn)), tokens);
}

export function clearChatHistory(userId: number): void {
  database.exec("BEGIN");
  try {
    database.prepare("DELETE FROM assistant_turns WHERE user_id = ?").run(userId);
    database.prepare("DELETE FROM assistant_context_summaries WHERE user_id = ?").run(userId);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
