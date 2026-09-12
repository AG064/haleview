import { dataFilePath } from "./runtime-path.js";
import {
  createHmac,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { database } from "./storage.js";
import { authEmailConfigured, sendAuthEmail } from "./email.js";
import { migrateProtectedText, protectStoredText, protectedLookupHash, unprotectStoredText } from "./protected-data.js";

const accessTokenSeconds = 15 * 60;
const refreshTokenSeconds = 30 * 24 * 60 * 60;
const verificationSeconds = 24 * 60 * 60;
const resetSeconds = 60 * 60;
const twoFactorChallengeSeconds = 5 * 60;
const totpStepSeconds = 30;

function loadJwtSecret(): string {
  // The signing key is read from configuration or a private runtime file.
  const configured = process.env.AUTH_JWT_SECRET?.trim();
  if (configured) {
    if (configured.length < 32) {
      throw new Error("AUTH_JWT_SECRET must contain at least 32 characters.");
    }
    return configured;
  }
  const dataFile = dataFilePath();
  const secretFile = resolve(process.env.AUTH_JWT_SECRET_FILE?.trim() || `${dataFile}.jwt-key`);
  try {
    const existing = readFileSync(secretFile, "utf8").trim();
    if (existing.length < 32) {
      throw new Error("AUTH_JWT_SECRET_FILE must contain at least 32 characters.");
    }
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  mkdirSync(dirname(secretFile), { recursive: true });
  const generated = randomBytes(32).toString("hex");
  try {
    writeFileSync(secretFile, `${generated}\n`, { flag: "wx", mode: 0o600 });
    return generated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const existing = readFileSync(secretFile, "utf8").trim();
    if (existing.length < 32) {
      throw new Error("AUTH_JWT_SECRET_FILE must contain at least 32 characters.", { cause: error });
    }
    return existing;
  }
}

const runtimeJwtSecret = loadJwtSecret();

database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    email_lookup TEXT,
    password_hash TEXT NOT NULL,
    email_verified_at TEXT,
    verification_token_hash TEXT,
    verification_expires_at TEXT,
    reset_token_hash TEXT,
    reset_expires_at TEXT,
    two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    two_factor_secret TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS auth_email_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_type TEXT NOT NULL,
    recipient TEXT NOT NULL,
    link TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS two_factor_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
`);

const refreshColumns = database.prepare("PRAGMA table_info(refresh_tokens)").all() as Array<{ name?: string }>;
if (!refreshColumns.some((column) => column.name === "session_id")) database.exec("ALTER TABLE refresh_tokens ADD COLUMN session_id TEXT");
database.exec("CREATE INDEX IF NOT EXISTS refresh_tokens_session ON refresh_tokens(session_id)");

const userColumns = database.prepare("PRAGMA table_info(users)").all() as Array<{ name?: string }>;
if (!userColumns.some((column) => column.name === "two_factor_secret")) {
  database.exec("ALTER TABLE users ADD COLUMN two_factor_secret TEXT");
}
if (!userColumns.some((column) => column.name === "email_lookup")) {
  database.exec("ALTER TABLE users ADD COLUMN email_lookup TEXT");
}

const legacyUserEmails = database
  .prepare("SELECT id, email, email_lookup FROM users")
  .all() as Array<{ id: number; email: string; email_lookup?: string | null }>;
if (legacyUserEmails.length > 0) {
  const updateUserEmail = database.prepare("UPDATE users SET email = ?, email_lookup = ? WHERE id = ?");
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const row of legacyUserEmails) {
      const email = unprotectStoredText(row.email).trim().toLowerCase();
      const encryptedEmail = row.email.startsWith("enc:v1:") ? row.email : protectStoredText(email);
      updateUserEmail.run(encryptedEmail, protectedLookupHash(email), row.id);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
database.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_email_lookup_unique ON users(email_lookup)");

const legacyEmailRows = database
  .prepare("SELECT id, recipient, link FROM auth_email_outbox WHERE recipient NOT LIKE 'enc:v1:%' OR link NOT LIKE 'enc:v1:%'")
  .all() as Array<{ id: number; recipient: string; link: string }>;
if (legacyEmailRows.length > 0) {
  const updateEmail = database.prepare("UPDATE auth_email_outbox SET recipient = ?, link = ? WHERE id = ?");
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const row of legacyEmailRows) {
      updateEmail.run(migrateProtectedText(row.recipient), migrateProtectedText(row.link), row.id);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export class AuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

export interface TwoFactorLoginChallenge {
  twoFactorRequired: true;
  challengeToken: string;
}

export interface AuthenticatedRequest extends Request {
  authUserId?: number;
}

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  email_verified_at?: string | null;
  verification_token_hash?: string | null;
  verification_expires_at?: string | null;
  reset_token_hash?: string | null;
  reset_expires_at?: string | null;
  two_factor_enabled?: number;
  two_factor_secret?: string | null;
}

function usesLocalPublicUrl(): boolean {
  try {
    const hostname = new URL(process.env.PUBLIC_APP_URL?.trim() || "http://127.0.0.1:5173").hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function checkEmailDelivery(): void {
  if (!usesLocalPublicUrl() && !authEmailConfigured()) throw new AuthError(503, "Email delivery is not configured. Use an available sign-in provider or contact the operator.");
}

function nowIso(): string {
  return new Date().toISOString();
}

function publicUrl(path: string, token: string, parameter = "token"): string {
  const base = (process.env.PUBLIC_APP_URL?.trim() || "http://127.0.0.1:5173").replace(/\/$/u, "");
  return `${base}${path}?${parameter}=${encodeURIComponent(token)}`;
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new AuthError(400, "Enter a valid email address.");
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new AuthError(400, "Enter a valid email address.");
  }
  return email;
}

function passwordValue(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new AuthError(400, "Password must be 8 to 128 characters.");
  }
  return value;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function hashToken(token: string): string {
  // A token hash can be checked without storing the token itself.
  return createHash("sha256").update(token).digest("hex");
}

function makeToken(): string {
  return randomBytes(32).toString("base64url");
}

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(value: Buffer): string {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += base32Alphabet[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) {
    output += base32Alphabet[(buffer << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(value: string): Buffer | null {
  const normalized = value.replace(/\s+/gu, "").toUpperCase();
  if (!normalized || !/^[A-Z2-7]+$/u.test(normalized)) {
    return null;
  }
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    buffer = (buffer << 5) | base32Alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}

function totpCode(secret: string, timestamp = Date.now()): string | null {
  const key = base32Decode(secret);
  if (!key) {
    return null;
  }
  const counter = BigInt(Math.floor(timestamp / 1000 / totpStepSeconds));
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", key).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(value % 1_000_000).padStart(6, "0");
}

function validTotp(secret: string | null | undefined, value: unknown): boolean {
  if (!secret || typeof value !== "string" || !/^\d{6}$/u.test(value)) {
    return false;
  }
  const currentTime = Date.now();
  for (const step of [-1, 0, 1]) {
    const expected = totpCode(secret, currentTime + step * totpStepSeconds * 1000);
    if (expected && timingSafeEqual(Buffer.from(expected), Buffer.from(value))) {
      return true;
    }
  }
  return false;
}

function storeEmail(emailType: string, recipient: string, link: string): void {
  database
    .prepare("INSERT INTO auth_email_outbox (email_type, recipient, link, created_at) VALUES (?, ?, ?, ?)")
    .run(emailType, protectStoredText(recipient), protectStoredText(link), nowIso());
}

function userByEmail(email: string): UserRow | undefined {
  const user = database
    .prepare("SELECT id, email, password_hash, email_verified_at, verification_token_hash, verification_expires_at, reset_token_hash, reset_expires_at, two_factor_enabled, two_factor_secret FROM users WHERE email_lookup = ?")
    .get(protectedLookupHash(email)) as UserRow | undefined;
  return unprotectUser(user);
}

function userById(id: number): UserRow | undefined {
  const user = database
    .prepare("SELECT id, email, password_hash, email_verified_at, verification_token_hash, verification_expires_at, reset_token_hash, reset_expires_at, two_factor_enabled, two_factor_secret FROM users WHERE id = ?")
    .get(id) as UserRow | undefined;
  return unprotectUser(user);
}

function unprotectUser(user: UserRow | undefined): UserRow | undefined {
  if (!user) return undefined;
  user.email = unprotectStoredText(user.email);
  if (user.two_factor_secret) user.two_factor_secret = unprotectStoredText(user.two_factor_secret);
  return user;
}

export function accountStatus(userId: number): { userId: number; twoFactorEnabled: boolean } {
  const user = userById(userId);
  if (!user) {
    throw new AuthError(401, "Sign in is required.");
  }
  return { userId, twoFactorEnabled: user.two_factor_enabled === 1 };
}

function signedToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", runtimeJwtSecret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function accessToken(userId: number, sessionId: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  return signedToken({
    sub: String(userId),
    type: "access",
    sid: sessionId,
    jti: randomBytes(12).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + accessTokenSeconds
  });
}

function issueTokens(userId: number, existingSessionId?: string | null, previousRefreshId?: number): AuthTokens {
  const refreshToken = makeToken();
  const expiresAt = new Date(Date.now() + refreshTokenSeconds * 1000).toISOString();
  const sessionId = existingSessionId ?? randomBytes(24).toString("base64url");
  database.exec("BEGIN IMMEDIATE");
  try {
    if (existingSessionId) {
      const session = database.prepare("SELECT expires_at, revoked_at FROM auth_sessions WHERE id = ? AND user_id = ?")
        .get(sessionId, userId) as { expires_at: string; revoked_at?: string | null } | undefined;
      if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.now()) throw new AuthError(401, "This session has ended. Sign in again.");
      database.prepare("UPDATE auth_sessions SET expires_at = ? WHERE id = ?").run(expiresAt, sessionId);
    } else database.prepare("INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(sessionId, userId, expiresAt);
    database.prepare("INSERT INTO refresh_tokens (user_id, token_hash, expires_at, session_id) VALUES (?, ?, ?, ?)")
      .run(userId, hashToken(refreshToken), expiresAt, sessionId);
    if (previousRefreshId !== undefined) database.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?").run(nowIso(), previousRefreshId);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
  return {
    accessToken: accessToken(userId, sessionId),
    refreshToken,
    accessTokenExpiresIn: accessTokenSeconds
  };
}

export function issueOAuthTokens(userId: number): AuthTokens | TwoFactorLoginChallenge {
  const user = database.prepare("SELECT id, two_factor_enabled, two_factor_secret FROM users WHERE id = ?").get(userId) as UserRow | undefined;
  if (!user) throw new AuthError(401, "This account is not available.");
  return completePrimaryAuthentication(user);
}

export function findOrCreateOAuthUser(emailInput: string): number {
  const email = normalizeEmail(emailInput);
  const existing = userByEmail(email);
  if (existing) return existing.id;
  return Number(database
    .prepare("INSERT INTO users (email, email_lookup, password_hash, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(
      protectStoredText(email),
      protectedLookupHash(email),
      `oauth$${randomBytes(24).toString("hex")}`,
      nowIso(),
      nowIso()
    ).lastInsertRowid);
}
function readJsonObject(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AuthError(400, "Request data must be an object.");
  }
  return input as Record<string, unknown>;
}

export async function register(input: unknown): Promise<{ userId: number; email: string; localDelivery: boolean }> {
  checkEmailDelivery();
  const value = readJsonObject(input);
  const email = normalizeEmail(value.email);
  const password = passwordValue(value.password);
  if (userByEmail(email)) {
    throw new AuthError(409, "An account with this email already exists.");
  }
  const verificationToken = makeToken();
  const createdAt = nowIso();
  const result = database
    .prepare("INSERT INTO users (email, email_lookup, password_hash, verification_token_hash, verification_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(
      protectStoredText(email),
      protectedLookupHash(email),
      hashPassword(password),
      hashToken(verificationToken),
      new Date(Date.now() + verificationSeconds * 1000).toISOString(),
      createdAt
    );
  const userId = Number(result.lastInsertRowid);
  const link = publicUrl("/api/auth/verify", verificationToken);
  const delivery = await sendAuthEmail({ type: "verification", recipient: email, link });
  if (delivery === "failed") {
    database.prepare("DELETE FROM users WHERE id = ? AND email_verified_at IS NULL").run(userId);
    throw new AuthError(503, "Verification email is not available. Check the email settings and try again.");
  }
  storeEmail("verification", email, link);
  return {
    userId,
    email,
    localDelivery: delivery === "local"
  };
}

export function verifyEmail(tokenValue: unknown): void {
  if (typeof tokenValue !== "string" || tokenValue.length < 20) {
    throw new AuthError(400, "The verification link is not valid.");
  }
  const tokenHash = hashToken(tokenValue);
  const user = database
    .prepare("SELECT id, email, password_hash, email_verified_at, verification_token_hash, verification_expires_at FROM users WHERE verification_token_hash = ?")
    .get(tokenHash) as UserRow | undefined;
  if (!user || !user.verification_expires_at || Date.parse(user.verification_expires_at) <= Date.now()) {
    throw new AuthError(400, "The verification link is not valid or has expired.");
  }
  database
    .prepare("UPDATE users SET email_verified_at = ?, verification_token_hash = NULL, verification_expires_at = NULL WHERE id = ?")
    .run(nowIso(), user.id);
}

function twoFactorChallenge(userId: number): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = signedToken({
    sub: String(userId),
    type: "2fa",
    jti: makeToken(),
    iat: issuedAt,
    exp: issuedAt + twoFactorChallengeSeconds
  });
  database
    .prepare("INSERT INTO two_factor_challenges (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
    .run(userId, hashToken(token), new Date(Date.now() + twoFactorChallengeSeconds * 1000).toISOString());
  return token;
}

export function login(input: unknown): AuthTokens | TwoFactorLoginChallenge {
  const value = readJsonObject(input);
  const email = normalizeEmail(value.email);
  const password = passwordValue(value.password);
  const user = userByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new AuthError(401, "Email or password is not correct.");
  }
  if (!user.email_verified_at) {
    throw new AuthError(403, "Verify your email before signing in.");
  }
  return completePrimaryAuthentication(user);
}

function completePrimaryAuthentication(user: UserRow): AuthTokens | TwoFactorLoginChallenge {
  if (user.two_factor_enabled === 1) {
    if (!user.two_factor_secret) {
      throw new AuthError(500, "Two-step sign-in is not ready.");
    }
    return { twoFactorRequired: true, challengeToken: twoFactorChallenge(user.id) };
  }
  return issueTokens(user.id);
}

function signedPayload(value: string): Record<string, unknown> {
  const parts = value.split(".");
  if (parts.length !== 3) {
    throw new AuthError(401, "The two-step code request is not valid.");
  }
  const signed = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", runtimeJwtSecret).update(signed).digest("base64url");
  if (expected.length !== parts[2].length || !timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) {
    throw new AuthError(401, "The two-step code request is not valid.");
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new Error("Invalid token payload");
    }
    return payload as Record<string, unknown>;
  } catch {
    throw new AuthError(401, "The two-step code request is not valid.");
  }
}

export function verifyTwoFactor(input: unknown): AuthTokens {
  const value = readJsonObject(input);
  const challengeToken = value.challengeToken;
  if (typeof challengeToken !== "string" || challengeToken.length < 20) {
    throw new AuthError(401, "The two-step code request is not valid.");
  }
  const payload = signedPayload(challengeToken);
  if (
    payload.type !== "2fa" ||
    typeof payload.sub !== "string" ||
    typeof payload.jti !== "string" ||
    typeof payload.exp !== "number" ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new AuthError(401, "The two-step code request is not valid.");
  }
  const userId = Number(payload.sub);
  const user = Number.isInteger(userId) ? userById(userId) : undefined;
  const challenge = database
    .prepare("SELECT id, user_id, expires_at, used_at FROM two_factor_challenges WHERE token_hash = ?")
    .get(hashToken(challengeToken)) as { id?: number; user_id?: number; expires_at?: string; used_at?: string | null } | undefined;
  const userWithFactor = user;
  if (
    !userWithFactor ||
    !challenge?.id ||
    challenge.user_id !== userId ||
    challenge.used_at ||
    !challenge.expires_at ||
    Date.parse(challenge.expires_at) <= Date.now() ||
    userWithFactor.two_factor_enabled !== 1 ||
    !validTotp(userWithFactor.two_factor_secret, value.code)
  ) {
    throw new AuthError(401, "The two-step code is not correct.");
  }
  const used = database
    .prepare("UPDATE two_factor_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL")
    .run(nowIso(), challenge.id);
  if (Number(used.changes) !== 1) {
    throw new AuthError(401, "The two-step code is not correct.");
  }
  return issueTokens(userId);
}

export function beginTwoFactor(userId: number): { secret: string; otpauthUri: string } {
  const user = userById(userId);
  if (!user) {
    throw new AuthError(401, "Sign in is required.");
  }
  const fullUser = user;
  if (!fullUser) {
    throw new AuthError(401, "Sign in is required.");
  }
  if (fullUser.two_factor_enabled === 1) {
    throw new AuthError(409, "Two-step sign-in is already enabled.");
  }
  const secret = base32Encode(randomBytes(20));
  database.prepare("UPDATE users SET two_factor_secret = ?, two_factor_enabled = 0 WHERE id = ?").run(protectStoredText(secret), userId);
  const issuer = "Haleview";
  const label = `${issuer}:${fullUser.email}`;
  const otpauthUri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&period=${totpStepSeconds}&digits=6`;
  return { secret, otpauthUri };
}

export function confirmTwoFactor(userId: number, input: unknown): void {
  const value = readJsonObject(input);
  const user = userById(userId);
  const fullUser = user;
  if (!fullUser || fullUser.two_factor_enabled === 1 || !fullUser.two_factor_secret) {
    throw new AuthError(400, "Start two-step sign-in setup first.");
  }
  if (!validTotp(fullUser.two_factor_secret, value.code)) {
    throw new AuthError(400, "The two-step code is not correct.");
  }
  database.prepare("UPDATE users SET two_factor_enabled = 1 WHERE id = ?").run(userId);
}

export function disableTwoFactor(userId: number, input: unknown): void {
  const value = readJsonObject(input);
  const user = userById(userId);
  const fullUser = user;
  if (!fullUser || fullUser.two_factor_enabled !== 1 || !fullUser.two_factor_secret) {
    throw new AuthError(400, "Two-step sign-in is not enabled.");
  }
  if (!validTotp(fullUser.two_factor_secret, value.code)) {
    throw new AuthError(400, "The two-step code is not correct.");
  }
  database.prepare("UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?").run(userId);
}

export function refresh(input: unknown): AuthTokens {
  const value = readJsonObject(input);
  const refreshToken = value.refreshToken;
  if (typeof refreshToken !== "string" || refreshToken.length < 20) {
    throw new AuthError(401, "The refresh token is not valid.");
  }
  const tokenHash = hashToken(refreshToken);
  const row = database
    .prepare("SELECT id, user_id, expires_at, revoked_at, session_id FROM refresh_tokens WHERE token_hash = ?")
    .get(tokenHash) as { id: number; user_id: number; expires_at: string; revoked_at?: string | null; session_id?: string | null } | undefined;
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now() || !userById(row.user_id)) {
    throw new AuthError(401, "The refresh token is not valid.");
  }
  return issueTokens(row.user_id, row.session_id, row.id);
}

export function logout(userId: number, authorization: string | undefined): void {
  if (!authorization?.startsWith("Bearer ")) throw new AuthError(401, "Sign in is required.");
  const payload = signedPayload(authorization.slice(7).trim());
  if (payload.sub !== String(userId) || typeof payload.sid !== "string") throw new AuthError(401, "This session has ended.");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND user_id = ?").run(nowIso(), payload.sid, userId);
    database.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE session_id = ? AND user_id = ? AND revoked_at IS NULL").run(nowIso(), payload.sid, userId);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

export function logoutSession(authorization: string | undefined): void {
  if (!authorization?.startsWith("Bearer ")) throw new AuthError(401, "Sign in is required.");
  const payload = signedPayload(authorization.slice(7).trim());
  const userId = Number(payload.sub);
  if (payload.type !== "access" || typeof payload.sub !== "string" || !Number.isSafeInteger(userId) || userId < 1) throw new AuthError(401, "This session is not valid.");
  // A signed expired token may revoke its own session, but cannot authorize data access.
  logout(userId, authorization);
}

export async function requestPasswordReset(input: unknown): Promise<{ localDelivery: boolean }> {
  checkEmailDelivery();
  const value = readJsonObject(input);
  const email = normalizeEmail(value.email);
  const user = userByEmail(email);
  if (!user) {
    return { localDelivery: !authEmailConfigured() };
  }
  const token = makeToken();
  database
    .prepare("UPDATE users SET reset_token_hash = ?, reset_expires_at = ? WHERE id = ?")
    .run(hashToken(token), new Date(Date.now() + resetSeconds * 1000).toISOString(), user.id);
  const link = publicUrl("/", token, "reset_token");
  storeEmail("password_reset", email, link);
  const delivery = await sendAuthEmail({ type: "password_reset", recipient: email, link });
  if (delivery === "failed") {
    database.prepare("UPDATE users SET reset_token_hash = NULL, reset_expires_at = NULL WHERE id = ?").run(user.id);
    throw new AuthError(503, "Reset email could not be sent. Try again later.");
  }
  return { localDelivery: delivery === "local" };
}

export function confirmPasswordReset(input: unknown): void {
  const value = readJsonObject(input);
  const token = value.token;
  if (typeof token !== "string" || token.length < 20) {
    throw new AuthError(400, "The reset link is not valid.");
  }
  const password = passwordValue(value.password);
  const user = database
    .prepare("SELECT id, email, password_hash, reset_token_hash, reset_expires_at FROM users WHERE reset_token_hash = ?")
    .get(hashToken(token)) as UserRow | undefined;
  if (!user || !user.reset_expires_at || Date.parse(user.reset_expires_at) <= Date.now()) {
    throw new AuthError(400, "The reset link is not valid or has expired.");
  }
  database.exec("BEGIN");
  try {
    database.prepare("UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_expires_at = NULL WHERE id = ?").run(hashPassword(password), user.id);
    database.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(nowIso(), user.id);
    database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(nowIso(), user.id);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function verifyAccessToken(value: string): number {
  let record: Record<string, unknown>;
  try {
    record = signedPayload(value);
  } catch {
    throw new AuthError(401, "Sign in is required.");
  }
  if (
    record.type !== "access" ||
    typeof record.sub !== "string" ||
    typeof record.sid !== "string" ||
    typeof record.exp !== "number" ||
    record.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new AuthError(401, "Sign in is required.");
  }
  const userId = Number(record.sub);
  if (!Number.isInteger(userId) || !userById(userId)) {
    throw new AuthError(401, "Sign in is required.");
  }
  const session = database.prepare("SELECT expires_at, revoked_at FROM auth_sessions WHERE id = ? AND user_id = ?")
    .get(record.sid as string, userId) as { expires_at: string; revoked_at?: string | null } | undefined;
  if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.now()) throw new AuthError(401, "This session has ended. Sign in again.");
  return userId;
}

export function requireAuth(request: Request, _response: Response, next: NextFunction): void {
  try {
    const header = request.header("authorization");
    if (!header || !header.startsWith("Bearer ")) {
      throw new AuthError(401, "Sign in is required.");
    }
    const userId = verifyAccessToken(header.slice("Bearer ".length).trim());
    (request as AuthenticatedRequest).authUserId = userId;
    next();
  } catch (error) {
    next(error);
  }
}

export function accessTokenUserId(header: string | undefined): number | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  try {
    return verifyAccessToken(header.slice("Bearer ".length).trim());
  } catch {
    return null;
  }
}

export function getLatestEmail(): { type: string; recipient: string; link: string; createdAt: string } | null {
  const row = database
    .prepare("SELECT email_type, recipient, link, created_at FROM auth_email_outbox ORDER BY id DESC LIMIT 1")
    .get() as { email_type?: string; recipient?: string; link?: string; created_at?: string } | undefined;
  if (!row?.email_type || !row.recipient || !row.link || !row.created_at) {
    return null;
  }
  return { type: row.email_type, recipient: unprotectStoredText(row.recipient), link: unprotectStoredText(row.link), createdAt: row.created_at };
}

export function authConfig(): { accessTokenMinutes: number; refreshTokenDays: number } {
  return { accessTokenMinutes: accessTokenSeconds / 60, refreshTokenDays: refreshTokenSeconds / (24 * 60 * 60) };
}

export const authMiddleware: RequestHandler = requireAuth;
