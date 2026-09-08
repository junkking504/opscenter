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
 * State is kept in a small JSON file so it survives restarts. Failures to read
 * or write it are logged and fail closed on read (treat as no history) but
 * never crash a login request.
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
    return payload && typeof payload === "object" ? payload as RateLimitState : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[login-rate-limit] state unreadable", error instanceof Error ? error.message : error);
    }
    return {};
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
  const state = readState();
  const address = clientAddress(headers);
  return !blocked(state, attemptKey(scope, address, identifier), now)
    && !blocked(state, addressKey(scope, address), now);
}

export function recordLoginFailure(
  scope: RateLimitScope,
  headers: Headers,
  identifier: string,
  now = Date.now(),
): void {
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
}

export function clearLoginFailures(
  scope: RateLimitScope,
  headers: Headers,
  identifier: string,
): void {
  const state = readState();
  const address = clientAddress(headers);
  delete state[attemptKey(scope, address, identifier)];
  delete state[addressKey(scope, address)];
  writeState(state);
}

export const LOGIN_RATE_LIMIT_WINDOW_MS = WINDOW_MS;
export const LOGIN_RATE_LIMIT_MAX_FAILURES = MAX_FAILURES;
