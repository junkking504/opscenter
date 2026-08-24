import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-collection-guard-"));
const healthFile = path.join(root, "health", "collector_failures.json");
const guard = path.join(process.cwd(), "scripts", "data-collection-hardening.sh");

function run(source: string): ReturnType<typeof spawnSync> {
  return spawnSync("/bin/bash", ["-c", source], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      OPSCENTER_COLLECTOR_HEALTH_FILE: healthFile,
      OPSCENTER_RELEASE_COMMIT: "test-release",
    },
  });
}

try {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failed = run([
      `source ${JSON.stringify(guard)}`,
      "assert_dns_answer() { return 0; }",
      "run_hardened_source test_source example.test /bin/sh -c 'echo token=not-for-logs >&2; exit 7'",
    ].join("\n"));
    assert.equal(failed.status, 1);
    assert.doesNotMatch(`${String(failed.stdout || "")}${String(failed.stderr || "")}`, /not-for-logs/);
  }

  const failedState = JSON.parse(fs.readFileSync(healthFile, "utf8"));
  assert.equal(failedState.conditions.length, 1);
  assert.equal(failedState.conditions[0].id, "test_source");
  assert.equal(failedState.conditions[0].consecutive_failures, 5);
  assert.equal(failedState.conditions[0].escalated, true);
  assert.doesNotMatch(failedState.conditions[0].error, /not-for-logs/);

  const succeeded = run([
    `source ${JSON.stringify(guard)}`,
    "assert_dns_answer() { return 0; }",
    "run_hardened_source test_source example.test /bin/sh -c 'echo verified'",
  ].join("\n"));
  assert.equal(succeeded.status, 0);
  assert.match(String(succeeded.stdout || ""), /verified/);
  const succeededState = JSON.parse(fs.readFileSync(healthFile, "utf8"));
  assert.deepEqual(succeededState.conditions, []);
  assert.equal(succeededState.last_successes.test_source.release_commit, "test-release");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("Data-collection shell guard tests passed.");
