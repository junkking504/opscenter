import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeTruckLoadPhoto } from "@/lib/truck-load-photo-analysis";
import { readTruckLoadStatuses, recordTruckLoadSnapshot } from "@/lib/truck-load-status";
import {
  formatTruckConsolidationPlan,
  ingestTruckLoadText,
  recordTruckLoadPhotoAnalysis,
  truckLoadPhotoRequest,
} from "@/lib/whatsapp-truck-loads";
import { claimCrewExpenseReply, queuedCrewExpenseReplies } from "@/lib/whatsapp-crew-expenses";
import type { WhatsAppImageMessage, WhatsAppTextMessage } from "@/lib/whatsapp-job-photo-queue";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-whatsapp-truck-loads-"));
process.env.OPSCENTER_DATA_DIR = testRoot;
process.env.WHATSAPP_TRUCK_LOAD_STATE_DIR = path.join(testRoot, "truck-load-messages");
process.env.WHATSAPP_CREW_EXPENSE_STATE_DIR = path.join(testRoot, "outbox");

function message(messageId: string, text: string, senderPhone = "5045550101", receivedAt = "2026-08-31T20:00:00.000Z"): WhatsAppTextMessage {
  return { messageId, text, senderPhone, receivedAt, phoneNumberId: "12345" };
}

const manualVariations = [
  "T9\n1/2 truck\nMostly metal",
  "Truck 9\n1/2 BRT\nMostly metal",
  "#9\n.5 truck\nMostly metal",
  "9\n.5 BRT\nMostly metal",
  "T9\n3 pickups\nMostly metal",
  "Truck #9\n3 loads\nMostly metal",
  "#9\n3pu\nMostly metal",
  "9\n3 pu\nMostly metal",
];
for (const [index, text] of manualVariations.entries()) {
  const receivedAt = `2026-08-31T20:0${index}:00.000Z`;
  const result = ingestTruckLoadText(message(`variation-${index}`, text, "5045550101", receivedAt));
  assert.equal(result.status, "updated");
  assert.equal(result.truck, "Truck# 9");
  const status = readTruckLoadStatuses("2026-08-31").find((entry) => entry.truck === "Truck# 9");
  assert.equal(status?.currentLoadFraction, 1 / 2);
  assert.equal(status?.currentContents, "Mostly metal");
  const reply = claimCrewExpenseReply(queuedCrewExpenseReplies()[0]);
  assert.ok(reply);
  assert.match(reply.reply.text, /Truck# 9 recorded at 1\/2 full/);
  assert.notEqual(reply.reply.text, "Recorded.");
}

const manual = ingestTruckLoadText(message("manual-1", "Truck 9\n1/2 truck\nsome metal, mostly junk", "5045550101", "2026-08-31T20:10:00.000Z"));
assert.equal(manual.status, "updated");
assert.equal(manual.truck, "Truck# 9");
const truck9 = readTruckLoadStatuses("2026-08-31").find((status) => status.truck === "Truck# 9");
assert.equal(truck9?.currentLoadFraction, 1 / 2);
assert.equal(truck9?.currentContents, "some metal, mostly junk");

assert.equal(ingestTruckLoadText(message("incomplete", "Truck status 8\n3/4 truck")).status, "review");
assert.equal(ingestTruckLoadText(message("ordinary", "JK4051234 after photos")).status, "ignored");

recordTruckLoadSnapshot({ date: "2026-08-31", truck: "Truck 2", loadFraction: 1 / 4, contents: "household junk", messageId: "truck-2", occurredAt: "2026-08-31T19:00:00.000Z" });
recordTruckLoadSnapshot({ date: "2026-08-31", truck: "Truck 3", loadFraction: 1 / 2, contents: "mostly junk", messageId: "truck-3", occurredAt: "2026-08-31T19:00:00.000Z" });
recordTruckLoadSnapshot({ date: "2026-08-31", truck: "Truck 4", loadFraction: 1 / 4, contents: "household junk", messageId: "truck-4", occurredAt: "2026-08-31T19:00:00.000Z" });
const plan = formatTruckConsolidationPlan("2026-08-31", readTruckLoadStatuses("2026-08-31"));
assert.match(plan, /Morning consolidation plan — 2026-09-01/);
assert.match(plan, /Move Truck# 4's 1\/4 full junk load into Truck# 3; Truck# 3 becomes 3\/4 full/);
assert.match(plan, /Move Truck# 2's 1\/4 full junk load into Truck# 3; Truck# 3 becomes Full truck/);
assert.match(plan, /Sort Truck# 9's mixed load first/);
assert.equal(ingestTruckLoadText(message("plan-1", "Consolidation plan")).status, "planned");

assert.equal(ingestTruckLoadText(message("dump-1", "#3 dumped")).status, "reset");
assert.equal(readTruckLoadStatuses("2026-08-31").find((status) => status.truck === "Truck# 3")?.currentLoadFraction, 0);
assert.equal(ingestTruckLoadText(message("dump-expense", "Dump\nTruck 3\nRiver Birch\n$75\n2 tons")).status, "ignored");

const imageMessage: WhatsAppImageMessage = {
  version: 1,
  messageId: "photo-1",
  senderPhone: "5045550102",
  receivedAt: "2026-08-31T21:00:00.000Z",
  phoneNumberId: "12345",
  mediaId: "media-1",
  mimeType: "image/jpeg",
  sha256: "",
  caption: "#6",
  enqueuedAt: "2026-08-31T21:00:01.000Z",
};
assert.equal(truckLoadPhotoRequest(imageMessage, "")?.truck, "Truck# 6");
assert.equal(truckLoadPhotoRequest({ ...imageMessage, caption: "6" }, "")?.truck, "Truck# 6");
assert.equal(truckLoadPhotoRequest({ ...imageMessage, caption: "JK4051234 before photo" }, ""), null);

recordTruckLoadPhotoAnalysis(imageMessage, "Truck 6", {
  loadFraction: 3 / 4,
  loadLabel: "3/4",
  contents: "furniture and household junk",
  confidence: 0.82,
  visibleEnough: true,
  notes: "Rear corners are visible.",
  model: "test-model",
});
assert.equal(ingestTruckLoadText(message("confirm-1", "CONFIRM #6", "5045550102", "2026-08-31T21:02:00.000Z")).status, "confirmed");
const truck6 = readTruckLoadStatuses("2026-08-31").find((status) => status.truck === "Truck# 6");
assert.equal(truck6?.currentLoadFraction, 3 / 4);
assert.equal(truck6?.currentContents, "furniture and household junk");

const photoFile = path.join(testRoot, "test.png");
fs.writeFileSync(photoFile, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
process.env.OPENAI_API_KEY = `sk-${"x".repeat(40)}`;
process.env.OPSBOT_TRUCK_VISION_MODEL = "gpt-5.4-mini";
const originalFetch = global.fetch;
let requestBody: Record<string, unknown> = {};
global.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
  assert.match(String(new Headers(init?.headers).get("authorization")), /^Bearer sk-/);
  requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
  return new Response(JSON.stringify({
    output_text: JSON.stringify({
      load_label: "1/2",
      contents: "mostly junk with some metal",
      confidence: 0.78,
      visible_enough: true,
      notes: "Cargo walls are visible.",
    }),
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;
void (async () => {
  try {
    const analyzed = await analyzeTruckLoadPhoto(photoFile);
    assert.equal(analyzed.loadFraction, 1 / 2);
    assert.equal(analyzed.contents, "mostly junk with some metal");
    assert.equal(requestBody?.model, "gpt-5.4-mini");
    assert.equal(requestBody?.store, false);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
  console.log("WhatsApp truck load verification passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
