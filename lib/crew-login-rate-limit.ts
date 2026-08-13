import { normalizeCrewUsername } from "./crew-auth";

type Attempt = { failures: number; blockedUntil: number; lastFailureAt: number };

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const attempts = new Map<string, Attempt>();

function clientAddress(headers: Headers): string {
  return String(
    headers.get("cf-connecting-ip")
      || headers.get("x-forwarded-for")?.split(",")[0]
      || headers.get("x-real-ip")
      || "unknown",
  ).trim().toLocaleLowerCase();
}

function attemptKey(headers: Headers, usernameValue: unknown): string {
  return `${clientAddress(headers)}:${normalizeCrewUsername(usernameValue) || "invalid"}`;
}

export function crewLoginAllowed(headers: Headers, usernameValue: unknown, now = Date.now()): boolean {
  const key = attemptKey(headers, usernameValue);
  const attempt = attempts.get(key);
  if (!attempt) return true;
  if (attempt.blockedUntil > now) return false;
  if (now - attempt.lastFailureAt > WINDOW_MS) attempts.delete(key);
  return true;
}

export function recordCrewLoginFailure(headers: Headers, usernameValue: unknown, now = Date.now()): void {
  const key = attemptKey(headers, usernameValue);
  const current = attempts.get(key);
  const failures = !current || now - current.lastFailureAt > WINDOW_MS ? 1 : current.failures + 1;
  attempts.set(key, {
    failures,
    lastFailureAt: now,
    blockedUntil: failures >= MAX_FAILURES ? now + WINDOW_MS : 0,
  });
}

export function clearCrewLoginFailures(headers: Headers, usernameValue: unknown): void {
  attempts.delete(attemptKey(headers, usernameValue));
}
