import { database } from "../storage.js";
import { protectStoredText, unprotectStoredText } from "../protected-data.js";
import { ChatError, type ChatTurn } from "./types.js";

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
`);

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
  database.prepare("DELETE FROM assistant_turns WHERE user_id = ?").run(userId);
}
