import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-operational-readiness-test-"));

function writeJson(target: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(payload));
}

async function main() {
  const now = Date.parse('2026-08-28T00:05:00Z');
  try {
    process.env.OPS_AUTH_USERNAME = "readiness-test";
    process.env.OPS_AUTH_PASSWORD_HASH = "pbkdf2-sha256$100000$c2FsdA$ZGVyaXZlZA";
    process.env.OPS_AUTH_SESSION_SECRET = "readiness-test-secret";
    const { getOperationalReadiness } = await import("../lib/operational-readiness");

    let readiness = getOperationalReadiness(temporaryRoot, now);
    assert.equal(readiness.ok, false);
    assert.equal(readiness.crewPortalSync.status, "unknown");
    assert.equal(readiness.photoQueue.available, false);
    for (const name of ['incoming','processing','completed','review','failed']) fs.mkdirSync(path.join(temporaryRoot,'integrations','whatsapp-job-photos',name),{recursive:true});

    writeJson(path.join(temporaryRoot, "integrations", "crew-portal-sync", "status.json"), {
      status: "synchronized",
      lastAttemptAt: "2026-08-28T00:00:00.000Z",
      lastSuccessAt: "2026-08-28T00:00:00.000Z",
    });
    writeJson(path.join(temporaryRoot, "integrations", "whatsapp-job-photos", "review", "queued.json"), {
      review: { reason: "sender_not_mapped_to_truck" },
    });
    readiness = getOperationalReadiness(temporaryRoot, now);
    assert.equal(readiness.photoQueue.ok, false);
    assert.equal(readiness.photoQueue.reasons.sender_not_mapped_to_truck, 1);

    fs.unlinkSync(path.join(temporaryRoot, "integrations", "whatsapp-job-photos", "review", "queued.json"));
    readiness = getOperationalReadiness(temporaryRoot, now);
    assert.equal(readiness.ok, true);
    assert.equal(getOperationalReadiness(temporaryRoot, now + 86400000).crewPortalSync.ok, false);
    assert.equal(getOperationalReadiness(temporaryRoot, now - 86400000).crewPortalSync.ok, false);
    fs.rmdirSync(path.join(temporaryRoot,'integrations','whatsapp-job-photos','incoming'));
    assert.equal(getOperationalReadiness(temporaryRoot, now).photoQueue.ok, false);
    console.log("Operational readiness checks passed.");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
