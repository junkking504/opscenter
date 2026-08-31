import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PodiumTokenEnvelope = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  issuedAt: string;
  updatedAt: string;
  scope: string;
};

type EncryptedTokenRecord = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
};

const DEFAULT_STORE_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "OpsCenter",
  "podium",
);

export const PODIUM_TOKEN_STORE_DIR = String(
  process.env.PODIUM_TOKEN_STORE_DIR || DEFAULT_STORE_DIR,
).trim();
export const PODIUM_TOKEN_STORE_FILE = path.join(PODIUM_TOKEN_STORE_DIR, "tokens.json");
const PODIUM_TOKEN_STORE_LOCK = path.join(PODIUM_TOKEN_STORE_DIR, ".refresh.lock");

function ensureDirectory(): void {
  fs.mkdirSync(PODIUM_TOKEN_STORE_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(PODIUM_TOKEN_STORE_DIR, 0o700);
}

function encryptionKey(): Buffer {
  const raw = String(process.env.PODIUM_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!raw) throw new Error("PODIUM_TOKEN_ENCRYPTION_KEY is required to access Podium tokens.");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("PODIUM_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hexadecimal characters.");
  }
  return key;
}

function parseRecord(value: string): EncryptedTokenRecord {
  const record = JSON.parse(value) as Partial<EncryptedTokenRecord>;
  if (record.version !== 1 || record.algorithm !== "aes-256-gcm" || !record.iv || !record.authTag || !record.ciphertext) {
    throw new Error("Podium token store is not a supported encrypted record.");
  }
  return record as EncryptedTokenRecord;
}

function encryptEnvelope(envelope: PodiumTokenEnvelope): EncryptedTokenRecord {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(envelope), "utf8"), cipher.final()]);
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptRecord(record: EncryptedTokenRecord): PodiumTokenEnvelope {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const envelope = JSON.parse(plaintext) as Partial<PodiumTokenEnvelope>;
  if (!envelope.accessToken || !envelope.refreshToken || !envelope.expiresAt) {
    throw new Error("Decrypted Podium token envelope is incomplete.");
  }
  return envelope as PodiumTokenEnvelope;
}

export function readPodiumTokenEnvelope(): PodiumTokenEnvelope | null {
  if (!fs.existsSync(PODIUM_TOKEN_STORE_FILE)) return null;
  return decryptRecord(parseRecord(fs.readFileSync(PODIUM_TOKEN_STORE_FILE, "utf8")));
}

export function writePodiumTokenEnvelope(envelope: PodiumTokenEnvelope): void {
  ensureDirectory();
  const temporary = `${PODIUM_TOKEN_STORE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(encryptEnvelope(envelope), null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, PODIUM_TOKEN_STORE_FILE);
  fs.chmodSync(PODIUM_TOKEN_STORE_FILE, 0o600);
}

export function podiumTokenStoreStatus() {
  const exists = fs.existsSync(PODIUM_TOKEN_STORE_FILE);
  let envelope: PodiumTokenEnvelope | null = null;
  let error: string | null = null;
  if (exists) {
    try { envelope = readPodiumTokenEnvelope(); } catch (caught) {
      error = caught instanceof Error ? caught.message : "Podium token store could not be read.";
    }
  }
  return {
    connected: Boolean(envelope),
    exists,
    encrypted: exists,
    error,
    updatedAt: envelope?.updatedAt || null,
    expiresAt: envelope?.expiresAt || null,
    scope: envelope?.scope || null,
  };
}

export function acquirePodiumRefreshLock(): boolean {
  ensureDirectory();
  try {
    const stats = fs.statSync(PODIUM_TOKEN_STORE_LOCK);
    if (Date.now() - stats.mtimeMs > 60_000) fs.unlinkSync(PODIUM_TOKEN_STORE_LOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  try {
    const fd = fs.openSync(PODIUM_TOKEN_STORE_LOCK, "wx", 0o600);
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export function releasePodiumRefreshLock(): void {
  if (fs.existsSync(PODIUM_TOKEN_STORE_LOCK)) fs.unlinkSync(PODIUM_TOKEN_STORE_LOCK);
}
