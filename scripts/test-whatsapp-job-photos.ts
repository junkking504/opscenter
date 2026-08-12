import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  extractJkNumber,
  inferPhotoCategory,
  matchWhatsAppPhoto,
  normalizePhone,
} from "@/lib/whatsapp-job-photo-matching";
import {
  enqueueWhatsAppImage,
  parseWhatsAppWebhook,
  queuedWhatsAppImages,
  recentWhatsAppText,
  recordWhatsAppTextContext,
  verifyMetaSignature,
} from "@/lib/whatsapp-job-photo-queue";
import {
  deliverWhatsAppPhotoSlackNotifications,
  formatWhatsAppPhotoSlackNotification,
  recordWhatsAppPhotoSlackUpload,
} from "@/lib/whatsapp-job-photo-slack";

async function main(): Promise<void> {
const now = new Date("2026-08-11T15:00:00.000Z");
const appointments = [
  { appt_id: "401", job_id: "JK4025001", job_status: "Confirmed", lat: 30, lng: -90 },
  { appt_id: "402", job_id: "JK4025002", job_status: "On Route", lat: 30.02, lng: -90.02 },
  { appt_id: "403", job_id: "JK4025003", job_status: "Cancelled", lat: 30, lng: -90 },
];
const fleet = [{ truck: "Truck# 8", latitude: 30.0001, longitude: -90.0001, lastGpsUpdate: "2026-08-11T14:55:00.000Z" }];

assert.equal(normalizePhone("+1 (504) 555-0101"), "5045550101");
assert.equal(extractJkNumber("after photos for JK 4025001"), "JK4025001");
assert.equal(extractJkNumber("4025001"), "JK4025001");
assert.equal(inferPhotoCategory("donation receipt"), "donation");
assert.equal(inferPhotoCategory("before loading"), "before");
assert.equal(inferPhotoCategory("job photos"), "after");

const explicit = matchWhatsAppPhoto({
  senderPhone: "5045550101",
  caption: "Before JK4025001",
  receivedAt: now,
  appointments,
  fleet: [],
  senderTruckMap: {},
});
assert.equal(explicit.status, "matched");
if (explicit.status === "matched") {
  assert.equal(explicit.method, "jk_number");
  assert.equal(explicit.appointmentId, "401");
  assert.equal(explicit.category, "before");
}

const nearest = matchWhatsAppPhoto({
  senderPhone: "+1 504-555-0101",
  caption: "After photos",
  receivedAt: now,
  appointments,
  fleet,
  senderTruckMap: { "5045550101": "Truck 8" },
});
assert.equal(nearest.status, "matched");
if (nearest.status === "matched") {
  assert.equal(nearest.method, "nearest_truck_gps");
  assert.equal(nearest.jkNumber, "JK4025001");
  assert.ok(Number(nearest.distanceMiles) < 0.02);
}

const unmapped = matchWhatsAppPhoto({
  senderPhone: "5045550199",
  caption: "photos",
  receivedAt: now,
  appointments,
  fleet,
  senderTruckMap: {},
});
assert.deepEqual(unmapped.status === "review" && unmapped.reason, "sender_not_mapped_to_truck");

const stale = matchWhatsAppPhoto({
  senderPhone: "5045550101",
  caption: "photos",
  receivedAt: now,
  appointments,
  fleet: [{ ...fleet[0], lastGpsUpdate: "2026-08-11T13:00:00.000Z" }],
  senderTruckMap: { "5045550101": "Truck 8" },
});
assert.deepEqual(stale.status === "review" && stale.reason, "truck_gps_stale");

const ambiguous = matchWhatsAppPhoto({
  senderPhone: "5045550101",
  caption: "photos",
  receivedAt: now,
  appointments: [
    appointments[0],
    { appt_id: "404", job_id: "JK4025004", job_status: "Confirmed", lat: 30.0002, lng: -90.0002 },
  ],
  fleet,
  senderTruckMap: { "5045550101": "Truck 8" },
});
assert.deepEqual(ambiguous.status === "review" && ambiguous.reason, "nearest_job_ambiguous");

const webhookPayload = {
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: "12345" },
    messages: [
      { id: "text-1", from: "15045550101", timestamp: "1786460100", type: "text", text: { body: "JK4025001" } },
      { id: "image-1", from: "15045550101", timestamp: "1786460160", type: "image", image: { id: "media-1", mime_type: "image/jpeg", sha256: "hash", caption: "before" } },
    ],
  } }] }],
};
const parsed = parseWhatsAppWebhook(webhookPayload);
assert.equal(parsed.images.length, 1);
assert.equal(parsed.texts.length, 1);
assert.deepEqual(parsed.phoneNumberIds, ["12345"]);

const rawBody = JSON.stringify(webhookPayload);
const appSecret = "test-app-secret";
const signature = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
assert.equal(verifyMetaSignature(rawBody, signature, appSecret), true);
assert.equal(verifyMetaSignature(`${rawBody}x`, signature, appSecret), false);

const temporaryState = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-whatsapp-test-"));
process.env.WHATSAPP_JOB_PHOTO_STATE_DIR = temporaryState;
try {
  recordWhatsAppTextContext(parsed.texts[0]);
  assert.equal(recentWhatsAppText(parsed.images[0].senderPhone, new Date(parsed.images[0].receivedAt), 10), "JK4025001");
  assert.equal(enqueueWhatsAppImage(parsed.images[0]).duplicate, false);
  assert.equal(enqueueWhatsAppImage(parsed.images[0]).duplicate, true);
  assert.equal(queuedWhatsAppImages().length, 1);

  const slackBatch = {
    version: 2 as const,
    batchId: "2026-08-11:JK4025001:image-1",
    jkNumber: "JK4025001",
    jobDate: "2026-08-11",
    openedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    photos: [
      { messageId: "image-1", category: "before" as const, receivedAt: parsed.images[0].receivedAt, status: "completed" as const },
      { messageId: "image-2", category: "after" as const, receivedAt: parsed.images[0].receivedAt, status: "completed" as const },
    ],
  };
  const formatted = formatWhatsAppPhotoSlackNotification(slackBatch);
  assert.match(formatted, /OpsBot added 2 photos/);
  assert.match(formatted, /JK4025001/);
  assert.match(formatted, /1 before · 1 after/);
  assert.doesNotMatch(formatted, /15045550101/);

  process.env.SLACK_OPSCENTER_ALERTS_ENABLED = "true";
  process.env.SLACK_WHATSAPP_PHOTO_NOTIFICATIONS_ENABLED = "true";
  process.env.SLACK_WHATSAPP_PHOTO_BATCH_QUIET_SECONDS = "60";
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
  process.env.SLACK_WHATSAPP_PHOTO_CHANNEL_ID = "C_TEST_DISPATCH";
  const requests: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
    return new Response(JSON.stringify({ ok: true, ts: "123.456" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const firstPhoto = {
    messageId: "image-1",
    jkNumber: "JK4025001",
    category: "before" as const,
    receivedAt: parsed.images[0].receivedAt,
    jobDate: "2026-08-11",
  };
  const secondPhoto = { ...firstPhoto, messageId: "image-2", category: "after" as const };
  assert.equal(recordWhatsAppPhotoSlackUpload({ ...firstPhoto, status: "pending", now }).duplicate, false);
  assert.equal(recordWhatsAppPhotoSlackUpload({ ...secondPhoto, status: "pending", now }).duplicate, false);
  assert.equal(recordWhatsAppPhotoSlackUpload({ ...firstPhoto, status: "completed", now }).duplicate, false);
  const incomplete = await deliverWhatsAppPhotoSlackNotifications({ now: new Date(now.getTime() + 120_000), fetchImpl });
  assert.equal(incomplete.attempted, 0);
  assert.equal(incomplete.pending, 1);
  const secondCompletedAt = new Date(now.getTime() + 10_000);
  assert.equal(recordWhatsAppPhotoSlackUpload({ ...secondPhoto, status: "completed", now: secondCompletedAt }).duplicate, false);
  const stillOpen = await deliverWhatsAppPhotoSlackNotifications({ now: new Date(now.getTime() + 50_000), fetchImpl });
  assert.equal(stillOpen.attempted, 0);
  const delivered = await deliverWhatsAppPhotoSlackNotifications({
    now: new Date(now.getTime() + 70_000),
    fetchImpl,
  });
  assert.equal(delivered.attempted, 1);
  assert.equal(delivered.delivered, 1);
  assert.equal(delivered.pending, 0);
  assert.equal(requests[0].channel, "C_TEST_DISPATCH");
  assert.match(String(requests[0].text), /JK4025001/);
  assert.match(String(requests[0].text), /added 2 photos/);
  assert.equal(recordWhatsAppPhotoSlackUpload({ ...firstPhoto, status: "completed", now }).duplicate, true);
  const duplicateDelivery = await deliverWhatsAppPhotoSlackNotifications({ now });
  assert.equal(duplicateDelivery.attempted, 0);
} finally {
  fs.rmSync(temporaryState, { recursive: true, force: true });
  delete process.env.WHATSAPP_JOB_PHOTO_STATE_DIR;
  delete process.env.SLACK_OPSCENTER_ALERTS_ENABLED;
  delete process.env.SLACK_WHATSAPP_PHOTO_NOTIFICATIONS_ENABLED;
  delete process.env.SLACK_WHATSAPP_PHOTO_BATCH_QUIET_SECONDS;
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_WHATSAPP_PHOTO_CHANNEL_ID;
}

console.log("WhatsApp job photo verification passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
