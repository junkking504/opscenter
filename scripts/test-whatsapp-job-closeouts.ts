import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  JOB_CLOSEOUT_CHARGES,
  formatJobCloseoutPreview,
  ingestJobCloseoutText,
  jobCloseoutTemplate,
} from "@/lib/whatsapp-job-closeouts";
import type { WhatsAppTextMessage } from "@/lib/whatsapp-job-photo-queue";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-job-closeouts-"));
process.chdir(testRoot);
process.env.WHATSAPP_JOB_CLOSEOUT_STATE_DIR = path.join(testRoot, "closeouts");
process.env.WHATSAPP_CREW_EXPENSE_STATE_DIR = path.join(testRoot, "outbox");
process.env.WHATSAPP_TRUCK_PHONE_MAP = JSON.stringify({
  "5045550101": "Truck 1",
  "5045550102": "Truck 2",
  "5045550103": "Truck 1",
  "5045550104": "Truck 1",
});

const date = "2026-08-13";
const receivedAt = new Date().toISOString();
const confirmationAt = new Date(new Date(receivedAt).getTime() + 60_000).toISOString();
const metricsDirectory = path.join(testRoot, "data", "history", "daily_metrics");
fs.mkdirSync(metricsDirectory, { recursive: true });
fs.writeFileSync(path.join(metricsDirectory, `daily_metrics_${date}.json`), JSON.stringify({
  appointments: [
    { appt_id: "501", job_id: "JK4051234", job_status: "Confirmed", truck: "Truck 1" },
    { appt_id: "502", job_id: "JK4051235", job_status: "Confirmed", truck: "Truck 2" },
    { appt_id: "503", job_id: "JK4051236", job_status: "Completed", truck: "Truck 1" },
  ],
}));

function message(messageId: string, text: string, senderPhone = "5045550101", messageReceivedAt = receivedAt): WhatsAppTextMessage {
  return { messageId, text, senderPhone, receivedAt: messageReceivedAt, phoneNumberId: "12345" };
}

assert.equal(JOB_CLOSEOUT_CHARGES.length, 16);
assert.deepEqual(JOB_CLOSEOUT_CHARGES.map((charge) => charge.label), [
  "Labor",
  "Refrigerator",
  "Mattress/Box Spring",
  "Tire",
  "E-Waste",
  "Misc",
  "Sofa/Couch",
  "Sleeper Sofa/Couch",
  "Commercial Refrigerator",
  "Hot Tub",
  "Piano",
  "Freon Appliance",
  "Microwave",
  "TVs/Electronics",
  "Gas Surcharge",
  "CC Surcharge (Card Present)",
]);
assert.equal(JOB_CLOSEOUT_CHARGES.at(-1)?.percentage, 3);
for (const charge of JOB_CLOSEOUT_CHARGES) assert.match(jobCloseoutTemplate(), new RegExp(charge.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
const orderedPrompt = jobCloseoutTemplate();
const promptSections = [
  "1. JK NUMBER",
  "2. TRUCK LOAD",
  "3. BEDLOAD",
  "4. INDIVIDUALLY PRICED ITEMS",
  "5. CREDIT CARD FEE",
  "6. DISCOUNT",
  "7. TIP",
  "8. JOB CATEGORY",
  "9. ACTUAL JOB TIME",
  "10. PAYMENT",
];
for (let index = 1; index < promptSections.length; index += 1) {
  assert.ok(orderedPrompt.indexOf(promptSections[index - 1]) < orderedPrompt.indexOf(promptSections[index]));
}
assert.match(orderedPrompt, /Send the lines separately or all at once, but keep this order/);

assert.equal(ingestJobCloseoutText(message("ordinary", "JK4051234 after photos")).status, "ignored");
const prompt = ingestJobCloseoutText(message("prompt", "Closeout"));
assert.equal(prompt.status, "prompted");

const allItems = [
  "Close JK4051234",
  "Truck load 1 x 1/2 @ $500",
  "Bedload 1 x 1/4 @ $100",
  "Labor 1 @ $75 each",
  "Refrigerator 1 @ $128",
  "Mattress/Box Spring 2 @ $30 each",
  "Tire 1 @ $20",
  "E-Waste 1 @ $30",
  "Misc 1 @ $10",
  "Sofa/Couch 1 @ $128",
  "Sleeper Sofa/Couch 1 @ $158",
  "Commercial Refrigerator 1 @ $158",
  "Hot Tub 1 @ $50",
  "Piano 1 @ $200",
  "Freon Appliance 1 @ $30",
  "Microwave 1 @ $30",
  "TVs/Electronics 1 @ $30",
  "Gas Surcharge 1 @ $20",
  "Credit card fee",
  "Discount $27",
  "Tip $49",
  "Category House Cleanout",
  "8:30 AM - 10:15 AM",
  "Credit Card $1800.00 last4 4242",
].join("\n");

const preview = ingestJobCloseoutText(message("all-items", allItems));
assert.equal(preview.status, "preview", JSON.stringify(preview));
assert.ok(preview.plan);
assert.equal(preview.plan.appointmentId, "501");
assert.equal(preview.plan.truck, "Truck# 1");
assert.equal(preview.plan.charges.length, 16);
assert.equal(preview.plan.chargesSubtotal, 1700, JSON.stringify(preview.plan.charges));
assert.equal(preview.plan.creditCardFee, 51);
assert.equal(preview.plan.jobTotal, 1751);
assert.equal(preview.plan.tip, 49);
assert.equal(preview.plan.paymentTotal, 1800);
assert.equal(preview.plan.paymentReconciles, true);
assert.match(formatJobCloseoutPreview(preview.plan), /CC Surcharge \(Card Present\): 3\.00% — \$51\.00/);
assert.match(formatJobCloseoutPreview(preview.plan), /Shadow mode cannot change JunkWare/);
assert.equal(ingestJobCloseoutText(message("all-items", allItems)).status, "duplicate");

const confirmation = ingestJobCloseoutText(message("confirm", "CONFIRM JK4051234", "5045550101", confirmationAt));
assert.equal(confirmation.status, "shadow_confirmed");

const missingFee = ingestJobCloseoutText(message("missing-fee", [
  "Close JK4051235",
  "Sofa/Couch 1 @ $128",
  "Category Furniture Removal",
  "9:00 AM - 9:30 AM",
  "Credit Card $128 last4 1111",
].join("\n"), "5045550102"));
assert.equal(missingFee.status, "collecting");
assert.ok(missingFee.missing?.some((problem) => /requires the CC Surcharge/.test(problem)));

const ambiguousQuantity = ingestJobCloseoutText(message("ambiguous-quantity", [
  "Close JK4051234",
  "2 mattresses $60",
].join("\n")));
assert.equal(ambiguousQuantity.status, "collecting");
assert.ok(ambiguousQuantity.missing?.some((problem) => /unit price/.test(problem)));

const wrongTruck = ingestJobCloseoutText(message("wrong-truck", "Close JK4051234", "5045550102"));
assert.equal(wrongTruck.status, "review");

const completed = ingestJobCloseoutText(message("completed", "Close JK4051236"));
assert.equal(completed.status, "review");

const unmapped = ingestJobCloseoutText(message("unmapped", "Close JK4051234", "5045550199"));
assert.equal(unmapped.status, "review");

const categoryDoesNotCreateCharge = ingestJobCloseoutText(message("category-overlap", [
  "Close JK4051234",
  "Sofa/Couch 1 @ $128",
  "Category Hot Tub Removal",
  "9:00 AM - 9:30 AM",
  "Cash $128",
].join("\n"), "5045550103"));
assert.equal(categoryDoesNotCreateCharge.status, "preview");
assert.deepEqual(categoryDoesNotCreateCharge.plan?.charges.map((charge) => charge.label), ["Sofa/Couch"]);

assert.equal(ingestJobCloseoutText(message("fuel-override-start", "Close JK4051234", "5045550104")).status, "collecting");
assert.equal(ingestJobCloseoutText(message("fuel-override", "Fuel", "5045550104")).status, "ignored");
assert.equal(ingestJobCloseoutText(message("fuel-after-override", "24 gallons", "5045550104")).status, "ignored");

process.stdout.write(`${JSON.stringify({ ok: true, chargeCount: JOB_CLOSEOUT_CHARGES.length, total: preview.plan.jobTotal })}\n`);
