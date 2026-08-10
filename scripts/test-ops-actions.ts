import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readOpsActionStore,
  reconcileOpsActionSignals,
  summarizeOpsActions,
  transitionOpsAction,
  type OpsActionSignal,
} from "@/lib/ops-actions";
import {
  applySlackInteraction,
  buildSlackActionBlocks,
  parseSlackInteraction,
  verifySlackSignature,
} from "@/lib/slack-interactions";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-actions-test-"));
process.env.OPSCENTER_ACTION_STORE_FILE = path.join(temporaryDirectory, "ops_actions.json");

const signal: OpsActionSignal = {
  fingerprint: "fleet_down:test-issue",
  kind: "fleet_down",
  lifecycle: "incident",
  severity: "critical",
  title: "Truck 1 is out of service",
  detail: "Hydraulic issue",
  nextAction: "Assign a repair owner.",
  href: "https://ops.junk-king.app/fleet",
};

try {
  const detectedAt = new Date("2026-08-10T15:00:00.000Z");
  const first = reconcileOpsActionSignals([signal], detectedAt).get(signal.fingerprint);
  assert.ok(first);
  assert.equal(first.status, "open");
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].type, "detected");

  const repeated = reconcileOpsActionSignals([signal], new Date("2026-08-10T15:05:00.000Z")).get(signal.fingerprint);
  assert.ok(repeated);
  assert.equal(repeated.actionId, first.actionId);
  assert.equal(repeated.updatedAt, first.updatedAt);
  assert.equal(readOpsActionStore().actions.length, 1);

  const acknowledged = transitionOpsAction({
    actionId: first.actionId,
    operation: "acknowledge",
    actor: { source: "opscenter", id: "manager@junk-king.com", label: "manager@junk-king.com" },
    now: new Date("2026-08-10T15:06:00.000Z"),
  });
  assert.equal(acknowledged?.status, "acknowledged");
  assert.equal(acknowledged?.ownerId, "manager@junk-king.com");

  const snoozed = transitionOpsAction({
    actionId: first.actionId,
    operation: "snooze",
    snoozeMinutes: 60,
    actor: { source: "opscenter", id: "manager@junk-king.com", label: "Manager" },
    now: new Date("2026-08-10T15:07:00.000Z"),
  });
  assert.equal(snoozed?.status, "snoozed");
  assert.equal(snoozed?.snoozedUntil, "2026-08-10T16:07:00.000Z");
  assert.equal(readOpsActionStore(new Date("2026-08-10T16:08:00.000Z")).actions[0].status, "open");

  const signingSecret = "test-signing-secret";
  const timestamp = "1786374000";
  const slackPayload = {
    type: "block_actions",
    team: { id: "T-test" },
    user: { id: "U-test", username: "dispatcher" },
    actions: [{ action_id: "ops_action_handle", value: first.actionId }],
    response_url: "https://hooks.slack.com/actions/T/B/test",
  };
  const rawBody = new URLSearchParams({ payload: JSON.stringify(slackPayload) }).toString();
  const signature = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  assert.equal(verifySlackSignature({ rawBody, timestamp, signature, signingSecret, now: new Date(Number(timestamp) * 1000) }), true);
  assert.equal(verifySlackSignature({ rawBody, timestamp, signature: `${signature}bad`, signingSecret, now: new Date(Number(timestamp) * 1000) }), false);
  assert.equal(verifySlackSignature({ rawBody, timestamp, signature, signingSecret, now: new Date((Number(timestamp) + 301) * 1000) }), false);

  const parsed = parseSlackInteraction(rawBody);
  assert.ok(parsed);
  const slackResult = applySlackInteraction(parsed, new Date("2026-08-10T15:08:00.000Z"));
  assert.equal(slackResult.ok, true);
  assert.equal(slackResult.action?.status, "handled");
  assert.equal(slackResult.action?.ownerId, "U-test");
  assert.ok(buildSlackActionBlocks(slackResult.action!, true).some((block) => block.type === "actions"));

  const resolved = reconcileOpsActionSignals([], new Date("2026-08-10T15:09:00.000Z")).get(signal.fingerprint);
  assert.ok(resolved);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.sourceActive, false);
  assert.equal(resolved.events.at(-1)?.type, "source_cleared");

  const reopened = reconcileOpsActionSignals([signal], new Date("2026-08-10T15:10:00.000Z")).get(signal.fingerprint);
  assert.ok(reopened);
  assert.equal(reopened.status, "open");
  assert.equal(reopened.events.at(-1)?.type, "reopened");
  assert.deepEqual(summarizeOpsActions(readOpsActionStore()).counts, {
    open: 1,
    acknowledged: 0,
    snoozed: 0,
    handled: 0,
    resolved: 0,
  });

  console.log("OpsCenter action engine verification passed.");
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
