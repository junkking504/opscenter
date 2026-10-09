import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupSignal } from "../lib/system-signals";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ops-backup-signal-"));
const previousData = process.env.OPSCENTER_DATA_DIR;
const previousAge = process.env.OPSCENTER_BACKUP_MAX_AGE_MINUTES;
const originalNow = Date.now;
Date.now = () => Date.parse("2026-10-09T16:00:00Z");
process.env.OPSCENTER_DATA_DIR = root;
process.env.OPSCENTER_BACKUP_MAX_AGE_MINUTES = "180";
fs.mkdirSync(path.join(root, "backup-sync"));
const state = path.join(root, "backup-sync/status.json");
const recent = "2026-10-09T15:59:00Z";
const stale = "2026-10-09T12:00:00Z";
const check = (payload: object) => {
  fs.writeFileSync(state, JSON.stringify(payload));
  return backupSignal();
};
try {
  assert.equal(backupSignal().status, "unknown");
  fs.writeFileSync(path.join(root, "backup-sync/publisher-status.json"), JSON.stringify({
    status: "deferred", exitCode: 124, caller: "continuity-publisher", timeoutSeconds: 90,
  }));
  assert.equal(backupSignal().status, "unknown", "A publisher timeout is not proof of any backup success");
  assert.equal(check({ status: "success", exitCode: 0, lastSuccessAt: recent }).status, "ok");
  for (const exitCode of [23, 124, 255]) {
    const result = check({ status: "failed", exitCode, lastSuccessAt: recent });
    assert.equal(result.status, "warn");
    assert.equal(result.lastSuccessAt, recent);
    assert.equal(result.lastExitCode, exitCode);
    assert.match(result.summary, new RegExp(`Latest backup failed \\(exit ${exitCode}\\)`));
    assert.match(result.summary, /1 minute ago/);
  }
  const failedStale = check({ status: "failed", exitCode: 23, lastSuccessAt: stale });
  assert.equal(failedStale.status, "critical", "Staleness takes precedence over latest failure");
  assert.match(failedStale.summary, /exit 23/);
  assert.equal(check({ status: "success", exitCode: 0, lastSuccessAt: stale }).status, "critical");
  const noSuccess = check({ status: "failed", error: "InterruptedError", lastSuccessAt: null });
  assert.equal(noSuccess.status, "warn");
  assert.equal(noSuccess.lastExitCode, null);
  assert.match(noSuccess.summary, /never recorded a success/);
  assert.doesNotMatch(noSuccess.summary, /exit/);
  assert.equal(check({ status: "running", lastSuccessAt: recent }).status, "ok");
  assert.equal(check({ status: "running", lastSuccessAt: null }).status, "unknown");
  assert.equal(check({ status: "success", exitCode: 24, lastSuccessAt: recent }).status, "ok");
  assert.equal(check({ status: "success", exitCode: 24, lastSuccessAt: stale }).status, "critical");
  assert.equal(check({ status: "failed", exitCode: null, lastSuccessAt: recent }).lastExitCode, null);
  assert.equal(check({ status: "success", exitCode: 0, lastSuccessAt: "invalid" }).status, "unknown");
  console.log("Backup signal checks passed: latest failures, stale precedence, missing evidence, running, and vanished files.");
} finally {
  Date.now = originalNow;
  if (previousData === undefined) delete process.env.OPSCENTER_DATA_DIR;
  else process.env.OPSCENTER_DATA_DIR = previousData;
  if (previousAge === undefined) delete process.env.OPSCENTER_BACKUP_MAX_AGE_MINUTES;
  else process.env.OPSCENTER_BACKUP_MAX_AGE_MINUTES = previousAge;
  fs.rmSync(root, { recursive: true, force: true });
}
