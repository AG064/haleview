import { dataFilePath } from "./runtime-path.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, createCipheriv, createDecipheriv, createHmac } from "node:crypto";
import { dirname, resolve } from "node:path";

const marker = "enc:v1:";

function readKeyFile(path: string): Buffer | null {
  try {
    const value = readFileSync(path, "utf8").trim();
    if (!value) {
      return null;
    }
    if (/^[0-9a-f]{64}$/iu.test(value)) {
      return Buffer.from(value, "hex");
    }
    const decoded = Buffer.from(value, "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

function loadKey(): Buffer {
  const configuredFile = process.env.DATA_ENCRYPTION_KEY_FILE?.trim();
  const configuredValue = process.env.DATA_ENCRYPTION_KEY?.trim();
  const fromValue = configuredValue && /^[0-9a-f]{64}$/iu.test(configuredValue)
    ? Buffer.from(configuredValue, "hex")
    : configuredValue
      ? Buffer.from(configuredValue, "base64")
      : null;
  if (configuredValue) {
    if (!fromValue || fromValue.length !== 32) {
      throw new Error("DATA_ENCRYPTION_KEY must be a 32-byte hex or base64 key.");
    }
    return fromValue;
  }
  if (configuredFile) {
    const fromFile = readKeyFile(resolve(configuredFile));
    if (fromFile) {
      return fromFile;
    }
    throw new Error("DATA_ENCRYPTION_KEY_FILE must contain a 32-byte key.");
  }

  const dataFile = dataFilePath();
  const generatedFile = `${dataFile}.key`;
  mkdirSync(dirname(generatedFile), { recursive: true });
  const existing = readKeyFile(generatedFile);
  if (existing) {
    return existing;
  }
  const generated = randomBytes(32);
  writeFileSync(generatedFile, `${generated.toString("hex")}\n`, { flag: "wx", mode: 0o600 });
  return generated;
}

const key = loadKey();
const lookupKey = createHmac("sha256", key).update("haleview lookup v1").digest();

export function protectedLookupHash(value: string): string {
  // HMAC supports exact lookup without storing the source value.
  return createHmac("sha256", lookupKey).update(value).digest("hex");
}

export function protectStoredText(value: string): string {
  // AES-GCM encrypts the value and detects changes to the stored data.
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${marker}${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function unprotectStoredText(value: string): string {
  if (!value.startsWith(marker)) {
    return value;
  }
  const parts = value.slice(marker.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Stored protected data is not valid.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "base64url"));
  decipher.setAuthTag(Buffer.from(parts[1], "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], "base64url")), decipher.final()]).toString("utf8");
}

export function isProtectedStoredText(value: string): boolean {
  return value.startsWith(marker);
}

export function migrateProtectedText(value: string): string {
  return isProtectedStoredText(value) ? value : protectStoredText(value);
}

export function protectedDataKeyPath(): string {
  const configuredFile = process.env.DATA_ENCRYPTION_KEY_FILE?.trim();
  if (configuredFile) {
    return resolve(configuredFile);
  }
  const dataFile = dataFilePath();
  return `${dataFile}.key`;
}
