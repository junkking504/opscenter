import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSlackOpsAlerts } from "@/lib/slack-alerts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-collector-alerting-"));
const stateFile = path.join(root, "slack-state.json");
const healthFile = path.join(root, "collector_failures.json");
const originalFetch = globalThis.fetch;
const posted: string[] = [];

process.env.SLACK_OPSCENTER_STATE_FILE = stateFile;
process.env.OPSCENTER_COLLECTOR_HEALTH_FILE = healthFile;
process.env.SLACK_OPSCENTER_ALERTS_ENABLED = "true";
process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
process.env.SLACK_OPS_DATA_HEALTH_CHANNEL_ID = "C_TEST_DATA_HEALTH";
globalThis.fetch = (async (_input, init) => {
  const body = JSON.parse(String(init?.body || "{}"));
  posted.push(String(body.text || ""));
  return new Response(JSON.stringify({ ok: true, channel: body.channel, ts: `1.${posted.length}` }), { status: 200 });
}) as typeof fetch;

async function main() {
try {
  fs.writeFileSync(healthFile, JSON.stringify({
    version: 2,
    conditions: [{
      id: "junkware_refresh",
      source: "Junkware Refresh",
      first_failed_at: "2026-08-24T18:00:00Z",
      failed_at: "2026-08-24T18:00:00Z",
      consecutive_failures: 1,
      error: "Required collector helper is unavailable.",
    }],
  }));
  const initial = await runSlackOpsAlerts({ date: "2026-08-24" });
  assert.equal(initial.posted.length, 1);
  assert.match(posted.at(-1) || "", /Junkware Refresh refresh failed/);
  assert.doesNotMatch(posted.at(-1) || "", /<!here>/);

  fs.writeFileSync(healthFile, JSON.stringify({
    version: 2,
    conditions: [{
      id: "junkware_refresh",
      source: "Junkware Refresh",
      first_failed_at: "2026-08-24T18:00:00Z",
      failed_at: "2026-08-24T18:05:00Z",
      consecutive_failures: 5,
      error: "Required collector helper is unavailable.",
    }],
  }));
  const escalation = await runSlackOpsAlerts({ date: "2026-08-24", onlyKinds: ["collector_failure"] });
  assert.equal(escalation.posted.length, 1);
  assert.match(posted.at(-1) || "", /^<!here>/);
  assert.match(posted.at(-1) || "", /5 consecutive failed refresh cycles/);

  fs.writeFileSync(healthFile, JSON.stringify({ version: 2, conditions: [] }));
  const recovery = await runSlackOpsAlerts({ date: "2026-08-24", onlyKinds: ["collector_failure"] });
  assert.equal(recovery.resolved.length, 2);
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.SLACK_OPSCENTER_STATE_FILE;
  delete process.env.OPSCENTER_COLLECTOR_HEALTH_FILE;
  delete process.env.SLACK_OPSCENTER_ALERTS_ENABLED;
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_OPS_DATA_HEALTH_CHANNEL_ID;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("Collector Slack alerting checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
