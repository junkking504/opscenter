import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Durable login throttling.
 *
 * The crew portal previously throttled from a module-level Map, which every
 * server restart erased - and with 1,376 restarts in a single log and eight
 * deploys inside 43 minutes, an attacker was handed a fresh allowance
 * constantly. The operator login, guarding all payroll and financial data, had
 * no throttle at all.
 *
 * State is kept in a small JSON file so it survives restarts. Updates are serialized across processes. Unreadable state blocks sign-in;
 * persistence failures abort authentication instead of silently losing limits.
 */

export type RateLimitScope = "ops" | "crew";

type Attempt = {
  failures: number;
  blockedUntil: number;
  lastFailureAt: number;
};

type RateLimitState = Record<string, Attempt>;

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_TRACKED_KEYS = 5000;

function stateFile(): string {
  const configured = String(process.env.OPSCENTER_LOGIN_RATE_LIMIT_FILE || "").trim();
  if (configured) return configured;
  const dataDir = String(process.env.OPSCENTER_DATA_DIR || "").trim()
    || path.join(process.cwd(), "data");
  return path.join(dataDir, "auth", "login-attempts.json");
}

function readState(): RateLimitState {
  try {
    const payload = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || Object.values(payload).some((value) => {
        const attempt = value as Attempt | null;
        return !attempt || !Number.isInteger(attempt.failures) || attempt.failures < 0
          || !Number.isFinite(attempt.blockedUntil) || !Number.isFinite(attempt.lastFailureAt);
      })) throw new Error("Invalid login attempt state");
    return payload as RateLimitState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.error("[login-rate-limit] state unreadable", error instanceof Error ? error.message : error);
    throw error;
  }
}

// The caller's clock, not the wall clock: tests drive this with synthetic
// timestamps, and pruning against Date.now() discarded entries the caller had
// just written.
function writeState(state: RateLimitState, now = Date.now()): void {
  const file = stateFile();
  const live = Object.entries(state)
    .filter(([, attempt]) => now - attempt.lastFailureAt < WINDOW_MS || attempt.blockedUntil > now)
    .sort(([, left], [, right]) => right.lastFailureAt - left.lastFailureAt)
    .slice(0, MAX_TRACKED_KEYS);

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(live)), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temporary, file);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  } catch (error) {
    console.error("[login-rate-limit] state could not be persisted", error instanceof Error ? error.message : error);
    throw error;
  }
}

// Publish a populated lock directory atomically. A contender can remove only
// the exact dead owner's marker and an empty directory, never a new owner's
// populated lock. No age-based stealing from a live login process.
function withStateLock<T>(work: () => T): T {
  const lock = `${stateFile()}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  const prepared = fs.mkdtempSync(`${lock}-`);
  const owner = `${process.pid}.${crypto.randomUUID()}`;
  fs.writeFileSync(path.join(prepared, owner), "", { mode: 0o600 });
  const wait = new Int32Array(new SharedArrayBuffer(4));
  let acquired = false;
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        fs.renameSync(prepared, lock);
        acquired = true;
        break;
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes(String((error as NodeJS.ErrnoException).code))) throw error;
        try {
          for (const entry of fs.readdirSync(lock)) {
            const match = entry.match(/^(\d+)\.[0-9a-f-]+$/);
            if (!match) continue;
            try { process.kill(Number(match[1]), 0); }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ESRCH") fs.unlinkSync(path.join(lock, entry));
            }
          }
          fs.rmdirSync(lock); // Fails while any owner's marker remains.
        } catch { /* A live owner or another contender still owns the lock. */ }
        Atomics.wait(wait, 0, 0, 10);
      }
    }
    if (!acquired) throw new Error("Login attempt store is busy. Try again.");
    return work();
  } finally {
    if (acquired) {
      fs.unlinkSync(path.join(lock, owner));
      try { fs.rmdirSync(lock); } catch { /* Another owner may have acquired it. */ }
    } else {
      fs.rmSync(prepared, { recursive: true, force: true });
    }
  }
}

export function clientAddress(headers: Headers): string {
  return String(
    headers.get("cf-connecting-ip")
      || headers.get("x-forwarded-for")?.split(",")[0]
      || headers.get("x-real-ip")
      || "unknown",
  ).trim().toLowerCase();
}

// Hash the identifier so a username is never written to disk in the clear.
function attemptKey(scope: RateLimitScope, address: string, identifier: string): string {
  return `${scope}:${crypto.createHash("sha256").update(`${address}|${identifier}`).digest("hex").slice(0, 32)}`;
}

// Address-only key so rotating usernames from one source still trips a lockout.
function addressKey(scope: RateLimitScope, address: string): string {
  return `${scope}!${crypto.createHash("sha256").update(address).digest("hex").slice(0, 32)}`;
}

function blocked(state: RateLimitState, key: string, now: number): boolean {
  const attempt = state[key];
  return Boolean(attempt && attempt.blockedUntil > now);
}

export function loginAllowed(
  scope: RateLimitScope,
  headers: Headers,
  identifier: string,
  now = Date.now(),
): boolean {
  try {
    const state = readState();
    const address = clientAddress(headers);
    return !blocked(state, attemptKey(scope, address, identifier), now)
      && !blocked(state, addressKey(scope, address), now);
  } catch {
    return false;
  }
}

export function recordLoginFailure(
  scope: RateLimitScope,
  headers: Headers,
  identifier: string,
  now = Date.now(),
): void {
  withStateLock(() => {
    const state = readState();
    const address = clientAddress(headers);

    for (const key of [attemptKey(scope, address, identifier), addressKey(scope, address)]) {
      const current = state[key];
      const failures = !current || now - current.lastFailureAt > WINDOW_MS ? 1 : current.failures + 1;
      state[key] = {
        failures,
        lastFailureAt: now,
        blockedUntil: failures >= MAX_FAILURES ? now + LOCKOUT_MS : 0,
      };
      if (failures >= MAX_FAILURES) {
        console.warn("[login-rate-limit] locking out after repeated failures", {
          scope,
          address,
          failures,
          lockoutMinutes: Math.round(LOCKOUT_MS / 60_000),
        });
      }
    }

    writeState(state, now);
  });
}

export function clearLoginFailures(
  scope: RateLimitScope,
  headers: Headers,
  identifier: string,
  now = Date.now(),
): void {
  withStateLock(() => {
    const state = readState();
    const address = clientAddress(headers);
    delete state[attemptKey(scope, address, identifier)];
    delete state[addressKey(scope, address)];
    writeState(state, now);
  });
}

export const LOGIN_RATE_LIMIT_WINDOW_MS = WINDOW_MS;
export const LOGIN_RATE_LIMIT_MAX_FAILURES = MAX_FAILURES;
