import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync } from "node:crypto";
import {
  AUTH_TRUSTED_DEVICE_MAX_AGE_SECONDS,
  createTrustedDeviceCookieValue,
  opsAuthDisplayName,
  opsAuthIdentity,
  publicAuthRoute,
  shouldRefreshTrustedDevice,
  verifyOpsCredentials,
  verifyTrustedDeviceCookie,
} from "../lib/auth";

const base64Url = (value: Buffer) => value.toString("base64url");
const username = "test-operator";
const password = "correct horse battery staple";
const salt = Buffer.from("opscenter-auth-test-salt");
const iterations = 100_000;
const derived = pbkdf2Sync(password, salt, iterations, 32, "sha256");

async function main() {
  process.env.OPS_AUTH_USERNAME = username;
  process.env.OPS_AUTH_PASSWORD_HASH = `pbkdf2-sha256$${iterations}$${base64Url(salt)}$${base64Url(derived)}`;
  process.env.OPS_AUTH_SESSION_SECRET = "opscenter-auth-trusted-device-test";

  assert.equal(await verifyOpsCredentials(username, password), true);
  assert.equal(await verifyOpsCredentials(username.toUpperCase(), password), true);
  assert.equal(await verifyOpsCredentials(username, "wrong password"), false);
  assert.equal(await verifyOpsCredentials("wrong-user", password), false);
  assert.equal(opsAuthIdentity(), `${username}@junk-king.com`);
  assert.equal(opsAuthDisplayName(opsAuthIdentity()), username);
  assert.equal(opsAuthDisplayName("manager@junk-king.com"), "manager@junk-king.com");
  assert.equal(publicAuthRoute("/junk-king-logo.svg"), true);
  assert.equal(publicAuthRoute("/icon"), true);
  assert.equal(publicAuthRoute("/apple-icon"), true);
  assert.equal(publicAuthRoute("/manifest.webmanifest"), true);
  assert.equal(publicAuthRoute("/fleet"), false);
  assert.equal(AUTH_TRUSTED_DEVICE_MAX_AGE_SECONDS, 60 * 60 * 24 * 30);
  assert.equal(
    shouldRefreshTrustedDevice({
      issuedAt: new Date("2026-08-01T00:00:00Z"),
      expiresAt: new Date("2026-08-31T00:00:00Z"),
    }, new Date("2026-08-08T00:00:00Z")),
    false,
    "A valid trusted-device credential must not silently roll its 30-day expiry.",
  );

  const trustedRequest = new Request("https://ops.junk-king.app/", {
    headers: { "user-agent": "OpsCenter auth test", "cf-connecting-ip": "198.51.100.24" },
  });
  const trustedValue = await createTrustedDeviceCookieValue(`${username}@junk-king.com`, trustedRequest, new Date("2026-08-01T00:00:00Z"));
  assert.ok(await verifyTrustedDeviceCookie(trustedValue, trustedRequest));

  const [legacyPayload] = trustedValue.split(".");
  const decodedLegacy = JSON.parse(Buffer.from(legacyPayload, "base64url").toString("utf8"));
  decodedLegacy.expiresAt = "2027-08-01T00:00:00.000Z";
  const overlongPayload = Buffer.from(JSON.stringify(decodedLegacy)).toString("base64url");
  const overlongSignature = createHmac("sha256", process.env.OPS_AUTH_SESSION_SECRET)
    .update(`trusted-device:${overlongPayload}`)
    .digest("base64url");
  const overlongValue = `${overlongPayload}.${overlongSignature}`;
  assert.equal(await verifyTrustedDeviceCookie(overlongValue, trustedRequest), null, "Legacy overlong trusted-device credentials must be rejected.");

  console.log("OpsCenter username/password authentication checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
