import { normalizeCrewUsername } from "./crew-auth";
import {
  clearLoginFailures,
  loginAllowed,
  recordLoginFailure,
} from "./login-rate-limit";

/**
 * Crew login throttling now delegates to the durable, shared limiter. The old
 * in-process Map was erased by every server restart, which under this deploy
 * cadence meant there was effectively no lockout at all.
 */

function identifier(usernameValue: unknown): string {
  return normalizeCrewUsername(usernameValue) || "invalid";
}

export function crewLoginAllowed(headers: Headers, usernameValue: unknown, now = Date.now()): boolean {
  return loginAllowed("crew", headers, identifier(usernameValue), now);
}

export function recordCrewLoginFailure(headers: Headers, usernameValue: unknown, now = Date.now()): void {
  recordLoginFailure("crew", headers, identifier(usernameValue), now);
}

export function clearCrewLoginFailures(headers: Headers, usernameValue: unknown): void {
  clearLoginFailures("crew", headers, identifier(usernameValue));
}
