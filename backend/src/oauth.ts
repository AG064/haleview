import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AuthError, findOrCreateOAuthUser, issueOAuthTokens, type AuthTokens } from "./auth.js";
import { database } from "./storage.js";
import { protectStoredText, protectedLookupHash, unprotectStoredText } from "./protected-data.js";

type OAuthProvider = "google" | "github";

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface OAuthIdentity {
  provider: OAuthProvider;
  subject: string;
  email: string;
}

export interface OAuthStart {
  url: string;
  binding: string;
}

database.exec(`
  CREATE TABLE IF NOT EXISTS oauth_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    state_hash TEXT NOT NULL UNIQUE,
    binding_hash TEXT,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS oauth_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    ticket_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS oauth_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    subject_lookup TEXT,
    UNIQUE(provider, subject)
  );
`);

const oauthStateColumns = database.prepare("PRAGMA table_info(oauth_states)").all() as Array<{ name?: string }>;
if (!oauthStateColumns.some((column) => column.name === "binding_hash")) {
  database.exec("ALTER TABLE oauth_states ADD COLUMN binding_hash TEXT");
}

const oauthIdentityColumns = database.prepare("PRAGMA table_info(oauth_identities)").all() as Array<{ name?: string }>;
if (!oauthIdentityColumns.some((column) => column.name === "subject_lookup")) {
  database.exec("ALTER TABLE oauth_identities ADD COLUMN subject_lookup TEXT");
}
const legacyOAuthSubjects = database.prepare("SELECT id, subject FROM oauth_identities").all() as Array<{ id: number; subject: string }>;
if (legacyOAuthSubjects.length > 0) {
  const updateSubject = database.prepare("UPDATE oauth_identities SET subject = ?, subject_lookup = ? WHERE id = ?");
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const row of legacyOAuthSubjects) {
      const subject = unprotectStoredText(row.subject);
      updateSubject.run(row.subject.startsWith("enc:v1:") ? row.subject : protectStoredText(subject), protectedLookupHash(subject), row.id);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
database.exec("CREATE UNIQUE INDEX IF NOT EXISTS oauth_identity_lookup_unique ON oauth_identities(provider, subject_lookup)");

function readSecret(fileVariable: string, valueVariable: string): string {
  const file = process.env[fileVariable]?.trim();
  if (file) {
    try {
      return readFileSync(resolve(file), "utf8").trim();
    } catch {
      return "";
    }
  }
  return process.env[valueVariable]?.trim() ?? "";
}

function providerConfig(provider: OAuthProvider): ProviderConfig | null {
  const publicUrl = (process.env.PUBLIC_APP_URL?.trim() || "http://127.0.0.1:5173").replace(/\/$/u, "");
  const prefix = provider === "google" ? "GOOGLE" : "GITHUB";
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim() ?? "";
  const clientSecret = readSecret(`${prefix}_CLIENT_SECRET_FILE`, `${prefix}_CLIENT_SECRET`);
  const redirectUri = process.env[`${prefix}_REDIRECT_URI`]?.trim() || `${publicUrl}/api/auth/oauth/${provider}/callback`;
  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }
  return { clientId, clientSecret, redirectUri };
}

function providerValue(value: unknown): OAuthProvider {
  if (value !== "google" && value !== "github") {
    throw new AuthError(404, "The sign-in provider is not available.");
  }
  return value;
}

function hashState(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

export function oauthProviderStatus(): Record<OAuthProvider, boolean> {
  return { google: providerConfig("google") !== null, github: providerConfig("github") !== null };
}

export function beginOAuth(input: unknown): OAuthStart {
  const provider = providerValue(input);
  const config = providerConfig(provider);
  if (!config) {
    throw new AuthError(503, "This sign-in provider is not configured.");
  }
  const state = randomBytes(32).toString("base64url");
  const binding = randomBytes(32).toString("base64url");
  database
    .prepare("INSERT INTO oauth_states (provider, state_hash, binding_hash, expires_at) VALUES (?, ?, ?, ?)")
    .run(provider, hashState(state), hashState(binding), new Date(Date.now() + 10 * 60 * 1000).toISOString());
  if (provider === "google") {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "openid email",
      state,
      access_type: "online",
      prompt: "select_account"
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, binding };
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "read:user user:email",
    state
  });
  return { url: `https://github.com/login/oauth/authorize?${params.toString()}`, binding };
}

async function exchangeCode(provider: OAuthProvider, config: ProviderConfig, code: string): Promise<OAuthIdentity> {
  if (provider === "google") {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code"
      })
    });
    if (!tokenResponse.ok) {
      throw new AuthError(502, "Google sign-in could not be completed.");
    }
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) {
      throw new AuthError(502, "Google sign-in did not return an access token.");
    }
    const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });
    if (!userResponse.ok) {
      throw new AuthError(502, "Google account details could not be read.");
    }
    const user = await userResponse.json() as { sub?: string; email?: string; email_verified?: boolean };
    if (!user.sub || !user.email || user.email_verified !== true) {
      throw new AuthError(400, "A verified email address is required for sign-in.");
    }
    return { provider, subject: user.sub, email: user.email.toLowerCase() };
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: config.redirectUri })
  });
  if (!tokenResponse.ok) {
    throw new AuthError(502, "GitHub sign-in could not be completed.");
  }
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) {
    throw new AuthError(502, "GitHub sign-in did not return an access token.");
  }
  const headers = { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "haleview" };
  const [userResponse, emailResponse] = await Promise.all([
    fetch("https://api.github.com/user", { headers }),
    fetch("https://api.github.com/user/emails", { headers })
  ]);
  if (!userResponse.ok || !emailResponse.ok) {
    throw new AuthError(502, "GitHub account details could not be read.");
  }
  const user = await userResponse.json() as { id?: number };
  const emails = await emailResponse.json() as Array<{ email?: string; verified?: boolean; primary?: boolean }>;
  const email = emails.find((item) => item.verified && item.primary)?.email
    ?? emails.find((item) => item.verified)?.email;
  if (!user.id || !email) {
    throw new AuthError(400, "A verified email address is required for sign-in.");
  }
  return { provider, subject: String(user.id), email: email.toLowerCase() };
}

function findOrCreateUser(identity: OAuthIdentity): number {
  const existingIdentity = database
    .prepare("SELECT user_id FROM oauth_identities WHERE provider = ? AND subject_lookup = ?")
    .get(identity.provider, protectedLookupHash(identity.subject)) as { user_id?: number } | undefined;
  if (existingIdentity?.user_id) {
    return existingIdentity.user_id;
  }
  const userId = findOrCreateOAuthUser(identity.email);
  database.prepare("INSERT INTO oauth_identities (user_id, provider, subject, subject_lookup) VALUES (?, ?, ?, ?)")
    .run(userId, identity.provider, protectStoredText(identity.subject), protectedLookupHash(identity.subject));
  return userId;
}

export async function completeOAuth(providerInput: unknown, state: unknown, code: unknown, binding: unknown): Promise<string> {
  const provider = providerValue(providerInput);
  if (typeof state !== "string" || state.length < 20 || typeof code !== "string" || code.length < 5 || typeof binding !== "string" || binding.length < 20) {
    throw new AuthError(400, "The sign-in response is not valid.");
  }
  const row = database
    .prepare("SELECT id, provider, binding_hash, expires_at, used_at FROM oauth_states WHERE state_hash = ?")
    .get(hashState(state)) as { id?: number; provider?: string; binding_hash?: string | null; expires_at?: string; used_at?: string | null } | undefined;
  if (!row?.id || row.provider !== provider || row.binding_hash !== hashState(binding) || row.used_at || !row.expires_at || Date.parse(row.expires_at) <= Date.now()) {
    throw new AuthError(400, "The sign-in request has expired.");
  }
  const used = database.prepare("UPDATE oauth_states SET used_at = ? WHERE id = ? AND used_at IS NULL").run(nowIso(), row.id);
  if (Number(used.changes) !== 1) {
    throw new AuthError(400, "The sign-in request has expired.");
  }
  const config = providerConfig(provider);
  if (!config) {
    throw new AuthError(503, "This sign-in provider is not configured.");
  }
  const identity = await exchangeCode(provider, config, code);
  const userId = findOrCreateUser(identity);
  const ticket = randomBytes(32).toString("base64url");
  database.prepare("INSERT INTO oauth_tickets (user_id, ticket_hash, expires_at) VALUES (?, ?, ?)").run(userId, hashState(ticket), new Date(Date.now() + 60_000).toISOString());
  return ticket;


}
export function exchangeOAuthTicket(ticket: unknown): AuthTokens {
  if (typeof ticket !== "string" || ticket.length < 20) {
    throw new AuthError(401, "The sign-in ticket is not valid.");
  }
  const row = database
    .prepare("SELECT id, user_id, expires_at, used_at FROM oauth_tickets WHERE ticket_hash = ?")
    .get(hashState(ticket)) as { id?: number; user_id?: number; expires_at?: string; used_at?: string | null } | undefined;
  if (!row?.id || !row.user_id || row.used_at || !row.expires_at || Date.parse(row.expires_at) <= Date.now()) {
    throw new AuthError(401, "The sign-in ticket is not valid.");
  }
  const used = database.prepare("UPDATE oauth_tickets SET used_at = ? WHERE id = ? AND used_at IS NULL").run(nowIso(), row.id);
  if (Number(used.changes) !== 1) {
    throw new AuthError(401, "The sign-in ticket is not valid.");
  }
  return issueOAuthTokens(row.user_id);
}
