import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

export type QboTokenEnvelope = {
  realmId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string | null;
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

export type QboTokenStoreStatus = {
  configured: boolean;
  directory: string;
  file: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  encrypted: boolean;
  lastModifiedAt: string | null;
  lastModifiedAtLabel: string | null;
  error: string | null;
  masked: {
    realmId: string | null;
    accessTokenPresent: boolean;
    refreshTokenPresent: boolean;
    expiresAt: string | null;
    refreshExpiresAt: string | null;
    updatedAt: string | null;
    scope: string | null;
  };
};

const DEFAULT_STORE_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "OpsCenter",
  "qbo",
);

export const QBO_TOKEN_STORE_DIR = String(process.env.QBO_TOKEN_STORE_DIR || DEFAULT_STORE_DIR).trim();
export const QBO_TOKEN_STORE_FILE = path.join(QBO_TOKEN_STORE_DIR, "tokens.json");
const QBO_TOKEN_STORE_LOCK = path.join(QBO_TOKEN_STORE_DIR, ".refresh.lock");

function formatTimestamp(value: Date | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function ensureDirectory(): void {
  fs.mkdirSync(QBO_TOKEN_STORE_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(QBO_TOKEN_STORE_DIR, 0o700);
}

function directoryWritable(): boolean {
  if (!fs.existsSync(QBO_TOKEN_STORE_DIR)) return true;
  try {
    fs.accessSync(QBO_TOKEN_STORE_DIR, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function encryptionKey(): Buffer {
  const raw = String(process.env.QBO_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!raw) {
    throw new Error("QBO_TOKEN_ENCRYPTION_KEY is required to access stored QBO tokens.");
  }

  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("QBO_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hexadecimal characters.");
  }
  return key;
}

function parseRecord(value: string): EncryptedTokenRecord {
  const record = JSON.parse(value) as Partial<EncryptedTokenRecord>;
  if (
    record.version !== 1 ||
    record.algorithm !== "aes-256-gcm" ||
    !record.iv ||
    !record.authTag ||
    !record.ciphertext
  ) {
    throw new Error("QBO token store is not a supported encrypted record.");
  }
  return record as EncryptedTokenRecord;
}

function encryptEnvelope(envelope: QboTokenEnvelope): EncryptedTokenRecord {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(envelope), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptRecord(record: EncryptedTokenRecord): QboTokenEnvelope {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(record.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const envelope = JSON.parse(plaintext) as Partial<QboTokenEnvelope>;
  if (!envelope.realmId || !envelope.accessToken || !envelope.refreshToken || !envelope.expiresAt) {
    throw new Error("Decrypted QBO token envelope is incomplete.");
  }
  return envelope as QboTokenEnvelope;
}

export function getQboTokenStoreStatus(): QboTokenStoreStatus {
  const exists = fs.existsSync(QBO_TOKEN_STORE_FILE);
  const stats = exists ? fs.statSync(QBO_TOKEN_STORE_FILE) : null;
  let envelope: QboTokenEnvelope | null = null;
  let error: string | null = null;

  if (exists) {
    try {
      envelope = readQboTokenEnvelope();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "QBO token store could not be read.";
    }
  }

  return {
    configured: Boolean(envelope),
    directory: QBO_TOKEN_STORE_DIR,
    file: QBO_TOKEN_STORE_FILE,
    exists,
    readable: Boolean(envelope),
    writable: directoryWritable(),
    encrypted: exists,
    lastModifiedAt: stats?.mtime?.toISOString() ?? null,
    lastModifiedAtLabel: formatTimestamp(stats?.mtime ?? null),
    error,
    masked: {
      realmId: envelope?.realmId ? "***" : null,
      accessTokenPresent: Boolean(envelope?.accessToken),
      refreshTokenPresent: Boolean(envelope?.refreshToken),
      expiresAt: envelope?.expiresAt ?? null,
      refreshExpiresAt: envelope?.refreshExpiresAt ?? null,
      updatedAt: envelope?.updatedAt ?? null,
      scope: envelope?.scope ?? null,
    },
  };
}

export function readQboTokenEnvelope(): QboTokenEnvelope | null {
  if (!fs.existsSync(QBO_TOKEN_STORE_FILE)) return null;
  return decryptRecord(parseRecord(fs.readFileSync(QBO_TOKEN_STORE_FILE, "utf8")));
}

export function writeQboTokenEnvelope(envelope: QboTokenEnvelope): void {
  ensureDirectory();
  const temporary = `${QBO_TOKEN_STORE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(encryptEnvelope(envelope), null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, QBO_TOKEN_STORE_FILE);
  fs.chmodSync(QBO_TOKEN_STORE_FILE, 0o600);
}

export function clearQboTokenStore(): void {
  if (!fs.existsSync(QBO_TOKEN_STORE_FILE)) return;
  fs.unlinkSync(QBO_TOKEN_STORE_FILE);
}

export function acquireQboRefreshLock(): boolean {
  ensureDirectory();
  try {
    const stats = fs.statSync(QBO_TOKEN_STORE_LOCK);
    if (Date.now() - stats.mtimeMs > 60_000) fs.unlinkSync(QBO_TOKEN_STORE_LOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  try {
    const fd = fs.openSync(QBO_TOKEN_STORE_LOCK, "wx", 0o600);
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export function releaseQboRefreshLock(): void {
  if (fs.existsSync(QBO_TOKEN_STORE_LOCK)) {
    fs.unlinkSync(QBO_TOKEN_STORE_LOCK);
  }
}
