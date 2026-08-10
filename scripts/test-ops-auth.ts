import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { opsAuthDisplayName, opsAuthIdentity, publicAuthRoute, verifyOpsCredentials } from "../lib/auth";

const base64Url = (value: Buffer) => value.toString("base64url");
const username = "test-operator";
const password = "correct horse battery staple";
const salt = Buffer.from("opscenter-auth-test-salt");
const iterations = 100_000;
const derived = pbkdf2Sync(password, salt, iterations, 32, "sha256");

async function main() {
  process.env.OPS_AUTH_USERNAME = username;
  process.env.OPS_AUTH_PASSWORD_HASH = `pbkdf2-sha256$${iterations}$${base64Url(salt)}$${base64Url(derived)}`;

  assert.equal(await verifyOpsCredentials(username, password), true);
  assert.equal(await verifyOpsCredentials(username.toUpperCase(), password), true);
  assert.equal(await verifyOpsCredentials(username, "wrong password"), false);
  assert.equal(await verifyOpsCredentials("wrong-user", password), false);
  assert.equal(opsAuthIdentity(), `${username}@junk-king.com`);
  assert.equal(opsAuthDisplayName(opsAuthIdentity()), username);
  assert.equal(opsAuthDisplayName("manager@junk-king.com"), "manager@junk-king.com");
  assert.equal(publicAuthRoute("/junk-king-logo.svg"), true);
  assert.equal(publicAuthRoute("/fleet"), false);

  console.log("OpsCenter username/password authentication checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
