import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  executeInternalSlackNotice,
  readCommunicationsControlSnapshot,
  verifyInternalSlackNotice,
  type InternalSlackNoticeInput,
} from "@/lib/communications-control";

function writeJson(file: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}

function queueFiles(directory: string, count: number): void {
  fs.mkdirSync(directory, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    writeJson(path.join(directory, `${String(index).padStart(64, "a")}.json`), { index });
  }
}

async function main() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-communications-control-"));
  const slackEnvironmentFile = path.join(temporaryDirectory, "slack.env");
  const photoRoot = path.join(temporaryDirectory, "integrations", "whatsapp-job-photos");
  const expenseRoot = path.join(temporaryDirectory, "integrations", "whatsapp-crew-expenses");
  process.env.OPSBOT_DATA_DIR = temporaryDirectory;
  process.env.OPSCENTER_SLACK_ENV_FILE = slackEnvironmentFile;
  process.env.SLACK_BOT_TOKEN = "xoxb-test-communications";
  fs.writeFileSync(slackEnvironmentFile, [
    "SLACK_OPSCENTER_ALERTS_ENABLED=true",
    "SLACK_OPS_COMMAND_CHANNEL_ID=C1234567890",
    "SLACK_OPSCENTER_BASE_URL=https://ops.example.test",
  ].join("\n"));
  writeJson(path.join(temporaryDirectory, "slack", "ops_alert_state.json"), {
    version: 5,
    updatedAt: "2099-09-01T15:00:00.000Z",
    active: { first: {}, second: {} },
    deliveredScheduleChangesByDate: { "2099-09-01": ["a", "b"] },
    deliveredCrewNotificationsByDate: { "2099-09-01": ["c"] },
    deliveredTruckArrivalsByDate: { "2099-09-01": ["d"] },
    deliveredTruckCloseoutsByDate: { "2099-09-01": ["e"] },
    deliveredPaymentNotificationsByDate: {},
  });
  queueFiles(path.join(photoRoot, "incoming"), 1);
  queueFiles(path.join(photoRoot, "completed"), 3);
  queueFiles(path.join(photoRoot, "review"), 2);
  queueFiles(path.join(photoRoot, "failed"), 1);
  queueFiles(path.join(photoRoot, "whatsapp-confirmations", "pending"), 1);
  queueFiles(path.join(photoRoot, "whatsapp-confirmations", "delivered"), 4);
  queueFiles(path.join(photoRoot, "slack-notifications", "batches", "pending"), 2);
  queueFiles(path.join(photoRoot, "slack-notifications", "batches", "delivered"), 5);
  queueFiles(path.join(expenseRoot, "transactions-pending"), 1);
  queueFiles(path.join(expenseRoot, "transactions-completed"), 6);
  queueFiles(path.join(expenseRoot, "review"), 2);
  queueFiles(path.join(expenseRoot, "outbox-incoming"), 1);
  queueFiles(path.join(expenseRoot, "outbox-sent"), 8);
  queueFiles(path.join(expenseRoot, "outbox-failed"), 3);
  writeJson(path.join(temporaryDirectory, "podium-google-reviews", "current.json"), {
    version: 1,
    source: "podium_api",
    fetchedAt: "2099-09-01T14:00:00.000Z",
    locations: [{
      uid: "location-1",
      name: "New Orleans",
      address: "",
      averageRating: 4.8,
      reviewCount: 50,
      reviews: [
        { uid: "review-1", authorName: "Customer", body: "Great", url: "", rating: 5, createdAt: "2099-09-01T13:00:00.000Z", updatedAt: "2099-09-01T13:00:00.000Z", needsResponse: true, responseCount: 0 },
        { uid: "review-2", authorName: "Customer", body: "Needs attention", url: "", rating: 2, createdAt: "2099-09-01T12:00:00.000Z", updatedAt: "2099-09-01T12:00:00.000Z", needsResponse: false, responseCount: 1 },
      ],
    }],
  });

  const input: InternalSlackNoticeInput = {
    subject: "Route plan update",
    message: "The afternoon route plan has been reviewed and approved.",
    owner: "Dispatch lead",
    nextAction: "Review the updated board before the next departure.",
  };

  try {
    process.env.OPSCENTER_RUNTIME = "MAC_MINI_PREVIEW";
    const snapshot = readCommunicationsControlSnapshot("2099-09-01");
    assert.equal(snapshot.mode, "preview_simulation");
    assert.equal(snapshot.slack.enabled, true);
    assert.equal(snapshot.slack.credentialAvailable, true);
    assert.equal(snapshot.slack.activeIncidents, 2);
    assert.equal(snapshot.slack.deliveredToday, 5);
    assert.equal(snapshot.whatsapp.photos.completed, 3);
    assert.equal(snapshot.whatsapp.photos.review, 2);
    assert.equal(snapshot.whatsapp.photoConfirmations.delivered, 4);
    assert.equal(snapshot.whatsapp.slackPhotoBatches.pending, 2);
    assert.equal(snapshot.whatsapp.expenses.completed, 6);
    assert.equal(snapshot.whatsapp.replies.failed, 3);
    assert.equal(snapshot.podium.locations, 1);
    assert.equal(snapshot.podium.recentNeedsResponse, 1);
    assert.equal(snapshot.podium.recentLowRatings, 1);
    assert.deepEqual(snapshot.podium.scopes, ["read_reviews", "read_locations"]);
    assert.match(snapshot.warning || "", /2 WhatsApp photos need review/);

    let previewFetchCalled = false;
    const previewReceipt = await executeInternalSlackNotice(input, "preview-action-run", (async () => {
      previewFetchCalled = true;
      throw new Error("Preview must not call Slack.");
    }) as typeof fetch);
    assert.equal(previewReceipt.mode, "preview_simulation");
    assert.equal(previewReceipt.posted, false);
    assert.equal(previewFetchCalled, false);
    assert.equal((await verifyInternalSlackNotice(previewReceipt)).outcome, "verified");

    process.env.OPSCENTER_RUNTIME = "MISSION_CONTROL";
    let requestBody: Record<string, unknown> = {};
    const liveReceipt = await executeInternalSlackNotice(input, "live-action-run", (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({ ok: true, channel: "C1234567890", ts: "2099.123456" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch);
    assert.equal(liveReceipt.mode, "live_control");
    assert.equal(liveReceipt.posted, true);
    assert.equal(liveReceipt.channelId, "C1234567890");
    assert.equal(liveReceipt.messageTs, "2099.123456");
    assert.match(String(requestBody.text || ""), /Route plan update/);
    assert.match(String(requestBody.text || ""), /OpsBot Control/);
    assert.match(String(requestBody.client_msg_id || ""), /^[0-9a-f-]{36}$/);
    assert.equal((await verifyInternalSlackNotice(liveReceipt)).outcome, "verified");

    await assert.rejects(executeInternalSlackNotice(input, "wrong-channel", (async () => new Response(JSON.stringify({
      ok: true,
      channel: "C_OTHER_CHANNEL",
      ts: "2099.234567",
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch), /different channel/);

    console.log("Communications snapshot, Slack approval adapter, delivery receipt, queue authority, Podium scope, and preview-isolation checks passed.");
  } finally {
    delete process.env.OPSBOT_DATA_DIR;
    delete process.env.OPSCENTER_SLACK_ENV_FILE;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.OPSCENTER_RUNTIME;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
