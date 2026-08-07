import "server-only";

import fs from "fs";
import os from "os";
import path from "path";

export type QboTokenEnvelope = {
  realmId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  issuedAt: string;
  updatedAt: string;
};

export type QboTokenStoreStatus = {
  configured: boolean;
  directory: string;
  file: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  lastModifiedAt: string | null;
  lastModifiedAtLabel: string | null;
  masked: {
    realmId: string | null;
    accessTokenPresent: boolean;
    refreshTokenPresent: boolean;
    expiresAt: string | null;
    updatedAt: string | null;
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
  try {
    fs.chmodSync(QBO_TOKEN_STORE_DIR, 0o700);
  } catch {
    // Best effort only. The directory remains outside the repo.
  }
}

export function getQboTokenStoreStatus(): QboTokenStoreStatus {
  const exists = fs.existsSync(QBO_TOKEN_STORE_FILE);
  const stats = exists ? fs.statSync(QBO_TOKEN_STORE_FILE) : null;
  let envelope: Partial<QboTokenEnvelope> | null = null;

  if (exists) {
    try {
      envelope = JSON.parse(fs.readFileSync(QBO_TOKEN_STORE_FILE, "utf8")) as Partial<QboTokenEnvelope>;
    } catch {
      envelope = null;
    }
  }

  return {
    configured: exists,
    directory: QBO_TOKEN_STORE_DIR,
    file: QBO_TOKEN_STORE_FILE,
    exists,
    readable: exists,
    writable: true,
    lastModifiedAt: stats?.mtime?.toISOString() ?? null,
    lastModifiedAtLabel: formatTimestamp(stats?.mtime ?? null),
    masked: {
      realmId: envelope?.realmId ? "***" : null,
      accessTokenPresent: Boolean(envelope?.accessToken),
      refreshTokenPresent: Boolean(envelope?.refreshToken),
      expiresAt: envelope?.expiresAt ?? null,
      updatedAt: envelope?.updatedAt ?? null,
    },
  };
}

export function readQboTokenEnvelope(): QboTokenEnvelope | null {
  if (!fs.existsSync(QBO_TOKEN_STORE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(QBO_TOKEN_STORE_FILE, "utf8")) as QboTokenEnvelope;
  } catch {
    return null;
  }
}

export function writeQboTokenEnvelope(envelope: QboTokenEnvelope): void {
  ensureDirectory();
  const tempFile = `${QBO_TOKEN_STORE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(envelope, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(tempFile, 0o600);
  } catch {
    // best effort only
  }
  fs.renameSync(tempFile, QBO_TOKEN_STORE_FILE);
  try {
    fs.chmodSync(QBO_TOKEN_STORE_FILE, 0o600);
  } catch {
    // best effort only
  }
}

export function clearQboTokenStore(): void {
  if (!fs.existsSync(QBO_TOKEN_STORE_FILE)) return;
  fs.unlinkSync(QBO_TOKEN_STORE_FILE);
}

export function acquireQboRefreshLock(): boolean {
  ensureDirectory();
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
