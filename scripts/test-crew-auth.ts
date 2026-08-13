import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createCrewSessionCookieValue,
  crewMemberForUsername,
  crewRoster,
  normalizeCrewUsername,
  verifyCrewSessionCookie,
} from "../lib/crew-auth";
import {
  authenticateCrewCredentials,
  crewPasswordPolicyError,
  setInitialCrewPassword,
} from "../lib/crew-credentials";
import { createPasswordHash, verifyPasswordHash } from "../lib/password-hash";
import {
  clearCrewLoginFailures,
  crewLoginAllowed,
  recordCrewLoginFailure,
} from "../lib/crew-login-rate-limit";

async function main() {
  const testDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "opscenter-crew-auth-"));
  process.env.OPS_CREW_CREDENTIALS_PATH = path.join(testDirectory, "crew-credentials.json");
  process.env.OPS_CREW_SESSION_SECRET = "crew-auth-test-secret-with-enough-entropy";
  process.env.OPS_CREW_ROSTER_JSON = JSON.stringify([
    { employee: "Test Crew Member", username: "JunkWare.User", active: true },
    { employee: "Inactive Member", username: "inactive", active: false },
  ]);
  const temporaryPassword = "Temporary123";
  const personalPassword = "Personal9876";
  process.env.OPS_CREW_TEMP_PASSWORD_HASH = await createPasswordHash(temporaryPassword, 100_000);

  try {
    assert.equal(normalizeCrewUsername(" JunkWare.User "), "junkware.user");
    assert.equal(normalizeCrewUsername("not a username"), "");
    assert.equal(crewRoster().length, 2);
    assert.equal(crewMemberForUsername("JUNKWARE.USER")?.employee, "Test Crew Member");
    assert.equal(crewMemberForUsername("inactive"), null);
    assert.equal(await verifyPasswordHash(temporaryPassword, process.env.OPS_CREW_TEMP_PASSWORD_HASH), true);
    assert.equal(await verifyPasswordHash("wrong", process.env.OPS_CREW_TEMP_PASSWORD_HASH), false);
    assert.equal(crewPasswordPolicyError("short"), "Use at least 10 characters.");
    assert.equal(crewPasswordPolicyError("letters-only"), "Include at least one letter and one number.");
    assert.equal(crewPasswordPolicyError(personalPassword), "");

    const rateLimitHeaders = new Headers({ "cf-connecting-ip": "192.0.2.10" });
    for (let attempt = 0; attempt < 7; attempt += 1) recordCrewLoginFailure(rateLimitHeaders, "junkware.user", attempt);
    assert.equal(crewLoginAllowed(rateLimitHeaders, "junkware.user", 7), true);
    recordCrewLoginFailure(rateLimitHeaders, "junkware.user", 8);
    assert.equal(crewLoginAllowed(rateLimitHeaders, "junkware.user", 9), false);
    clearCrewLoginFailures(rateLimitHeaders, "junkware.user");
    assert.equal(crewLoginAllowed(rateLimitHeaders, "junkware.user", 10), true);

    const initial = await authenticateCrewCredentials("JUNKWARE.USER", temporaryPassword);
    assert.equal(initial?.member.employee, "Test Crew Member");
    assert.equal(initial?.passwordChangeRequired, true);
    assert.equal(await authenticateCrewCredentials("junkware.user", "wrong"), null);

    const temporarySession = await createCrewSessionCookieValue(initial!.member, true);
    assert.equal((await verifyCrewSessionCookie(temporarySession))?.passwordChangeRequired, true);
    assert.equal(await verifyCrewSessionCookie(`${temporarySession}tampered`), null);
    const activeRoster = process.env.OPS_CREW_ROSTER_JSON;
    process.env.OPS_CREW_ROSTER_JSON = JSON.stringify([
      { employee: "Test Crew Member", username: "JunkWare.User", active: false },
    ]);
    assert.equal(await verifyCrewSessionCookie(temporarySession), null);
    process.env.OPS_CREW_ROSTER_JSON = activeRoster;

    assert.deepEqual(
      await setInitialCrewPassword("junkware.user", "Test Crew Member", temporaryPassword),
      { ok: false, reason: "temporary-password" },
    );
    assert.deepEqual(
      await setInitialCrewPassword("junkware.user", "Test Crew Member", personalPassword),
      { ok: true },
    );
    assert.equal(await authenticateCrewCredentials("junkware.user", temporaryPassword), null);
    const personal = await authenticateCrewCredentials("junkware.user", personalPassword);
    assert.equal(personal?.passwordChangeRequired, false);
    assert.deepEqual(
      await setInitialCrewPassword("junkware.user", "Test Crew Member", "Another1234"),
      { ok: false, reason: "already-set" },
    );

    const saved = JSON.parse(await fs.readFile(process.env.OPS_CREW_CREDENTIALS_PATH, "utf8"));
    assert.equal(saved.users["junkware.user"].employee, "Test Crew Member");
    assert.equal(saved.users["junkware.user"].passwordHash.includes(personalPassword), false);
    assert.equal((await fs.stat(process.env.OPS_CREW_CREDENTIALS_PATH)).mode & 0o077, 0);

    const now = new Date("2026-08-13T12:00:00.000Z");
    const expiring = await createCrewSessionCookieValue(personal!.member, false, now);
    assert.equal((await verifyCrewSessionCookie(expiring, new Date("2026-08-14T12:00:00.000Z")))?.employee, "Test Crew Member");
    assert.equal(await verifyCrewSessionCookie(expiring, new Date("2026-09-13T12:00:01.000Z")), null);
    console.log("Crew username, temporary-password, forced setup, and personal-password checks passed.");
  } finally {
    await fs.rm(testDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
