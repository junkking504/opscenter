import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const checker = path.join(root, "deploy", "macmini", "verify-collector-reference-integrity.sh");
const refreshHealth = path.join(root, "deploy", "macmini", "verify-junkware-refresh-health.sh");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-deploy-integrity-"));
const collectorSource = path.join(fixtureRoot, "run_opscenter_refresh.sh");
const releaseCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const healthLog = path.join(fixtureRoot, "opscenter_safe_background_refresh.log");

try {
  fs.writeFileSync(collectorSource, "HARDENING=\"$OPSCENTER_DIR/scripts/data-collection-hardening.sh\"\n", { mode: 0o755 });
  const resolved = spawnSync(checker, ["--release", root, "--collector-source", collectorSource], { encoding: "utf8" });
  assert.equal(resolved.status, 0, String(resolved.stderr));
  assert.match(String(resolved.stdout), /reference integrity passed/i);

  fs.writeFileSync(collectorSource, "HARDENING=\"$OPSCENTER_DIR/scripts/not-committed-helper.sh\"\n", { mode: 0o755 });
  const missing = spawnSync(checker, ["--release", root, "--collector-source", collectorSource], { encoding: "utf8" });
  assert.notEqual(missing.status, 0);
  assert.match(String(missing.stderr), /not-committed-helper\.sh/);

  fs.writeFileSync(healthLog, [
    `OPSCENTER_COLLECTOR_RELEASE=${releaseCommit}`,
    " REFRESH COMPLETED SUCCESSFULLY",
  ].join("\n"));
  const healthy = spawnSync(refreshHealth, ["--release", root, "--log", healthLog, "--timeout-seconds", "0"], { encoding: "utf8" });
  assert.equal(healthy.status, 0, String(healthy.stderr));

  fs.writeFileSync(healthLog, `OPSCENTER_COLLECTOR_RELEASE=${releaseCommit}\n`);
  const unhealthy = spawnSync(refreshHealth, ["--release", root, "--log", healthLog, "--timeout-seconds", "0"], { encoding: "utf8" });
  assert.notEqual(unhealthy.status, 0);
  assert.match(String(unhealthy.stderr), /no full refresh completion/i);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("Collector deployment integrity checks passed.");
