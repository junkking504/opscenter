import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  claimCrewExpenseReply,
  claimCrewExpenseTransaction,
  crewExpenseTemplates,
  finishCrewExpenseTransaction,
  ingestCrewExpenseText,
  queuedCrewExpenseTransactions,
  queuedCrewExpenseReplies,
  readCrewExpenseRecords,
  updateCrewExpenseTransaction,
} from "@/lib/whatsapp-crew-expenses";
import { formatCrewExpenseSlackNotification, sendCrewExpenseSlackNotification } from "@/lib/whatsapp-crew-expense-slack";
import type { WhatsAppTextMessage } from "@/lib/whatsapp-job-photo-queue";

const state = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-crew-expenses-"));
process.env.WHATSAPP_CREW_EXPENSE_STATE_DIR = state;

function message(
  messageId: string,
  text: string,
  senderPhone = "5045550101",
  receivedAt = "2026-08-12T15:00:00.000Z",
): WhatsAppTextMessage {
  return {
    messageId,
    senderPhone,
    receivedAt,
    phoneNumberId: "12345",
    text,
  };
}

assert.equal(crewExpenseTemplates.dump, "Truck 1\nGentilly Landfill\n$86.40\n2 tons\n1035");
assert.equal(crewExpenseTemplates.fuel, "Truck 1\nShell\n24 gallons\n$100\n212");

const prompt = ingestCrewExpenseText(message("prompt-dump", "Dump"));
assert.equal(prompt.status, "prompted");
assert.equal(queuedCrewExpenseReplies().length, 1);
const promptReply = claimCrewExpenseReply(queuedCrewExpenseReplies()[0]);
assert.ok(promptReply);
assert.match(promptReply.reply.text, /Weight is optional/);
assert.match(promptReply.reply.text, /no labels needed/);
assert.doesNotMatch(promptReply.reply.text, /Truck #:/);

const dump = ingestCrewExpenseText(message("dump-1", [
  "Dump",
  "Truck #: 8",
  "Location: Gentilly Landfill",
  "Cost: $ 86.40",
  "Weight:",
  "Time: 10:35 AM",
].join("\n")));
assert.equal(dump.status, "queued");
assert.equal(dump.record?.truck, "Truck# 8");
assert.equal(dump.record?.cost, 86.4);
assert.equal(dump.record?.weight, null);
assert.equal(dump.record?.time, "10:35 AM");
assert.equal(dump.record?.date, "2026-08-12");

const fuel = ingestCrewExpenseText(message("fuel-1", [
  "Fuel",
  "Truck #: Truck 2",
  "Location: Shell on Airline",
  "Cost: 124.59",
  "Gallons: 31.725 gallons",
  "Time: 14:05",
].join("\n")));
assert.equal(fuel.status, "queued");
assert.equal(fuel.record?.truck, "Truck# 2");
assert.equal(fuel.record?.gallons, 31.725);
assert.equal(fuel.record?.time, "2:05 PM");

const incomplete = ingestCrewExpenseText(message("fuel-incomplete", [
  "Fuel",
  "Truck #: 2",
  "Location: Shell",
  "Cost: 50",
  "Gallons:",
  "Time: 2:10 PM",
].join("\n")));
assert.equal(incomplete.status, "review");
assert.deepEqual(incomplete.missing, ["gallons"]);
assert.equal(readCrewExpenseRecords("2026-08-12").length, 0);
assert.equal(ingestCrewExpenseText(message("fuel-1", "Fuel")).status, "duplicate");

const ordinary = ingestCrewExpenseText(message("ordinary", "JK4049525 after photos"));
assert.equal(ordinary.status, "ignored");
assert.equal(readCrewExpenseRecords("2026-08-13").length, 0);

const freeformFuelPhone = "5045550202";
assert.equal(ingestCrewExpenseText(message("freeform-fuel-prompt", "Fuel", freeformFuelPhone, "2026-08-12T19:10:00.000Z")).status, "prompted");
assert.equal(ingestCrewExpenseText(message("freeform-fuel-truck", "Truck 1", freeformFuelPhone, "2026-08-12T19:11:00.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("freeform-fuel-location", "Shell", freeformFuelPhone, "2026-08-12T19:11:10.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("freeform-fuel-gallons", "24 gallons", freeformFuelPhone, "2026-08-12T19:11:20.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("freeform-fuel-cost", "$100.", freeformFuelPhone, "2026-08-12T19:11:30.000Z")).status, "collecting");
const freeformFuel = ingestCrewExpenseText(message("freeform-fuel-time", "212", freeformFuelPhone, "2026-08-12T19:12:00.000Z"));
assert.equal(freeformFuel.status, "queued");
assert.equal(freeformFuel.record?.truck, "Truck# 1");
assert.equal(freeformFuel.record?.location, "Shell");
assert.equal(freeformFuel.record?.gallons, 24);
assert.equal(freeformFuel.record?.cost, 100);
assert.equal(freeformFuel.record?.time, "2:12 PM");
assert.equal(freeformFuel.record?.sourceMessageIds?.length, 6);

const freeformDumpPhone = "5045550303";
assert.equal(ingestCrewExpenseText(message("freeform-dump-prompt", "Dump", freeformDumpPhone, "2026-08-12T15:30:00.000Z")).status, "prompted");
assert.equal(ingestCrewExpenseText(message("freeform-dump-truck", "Truck 6", freeformDumpPhone, "2026-08-12T15:31:00.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("freeform-dump-location", "River Birch", freeformDumpPhone, "2026-08-12T15:31:10.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("freeform-dump-cost", "$75", freeformDumpPhone, "2026-08-12T15:31:20.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("freeform-dump-weight", "1.2 tons", freeformDumpPhone, "2026-08-12T15:31:30.000Z")).status, "collecting");
const freeformDump = ingestCrewExpenseText(message("freeform-dump-time", "1035", freeformDumpPhone, "2026-08-12T15:35:00.000Z"));
assert.equal(freeformDump.status, "queued");
assert.equal(freeformDump.record?.weight, "1.2 tons");
assert.equal(freeformDump.record?.time, "10:35 AM");

const compactFuel = ingestCrewExpenseText(message("compact-fuel", [
  "Fuel",
  "Truck 3",
  "Shell on Airline",
  "15 gallons",
  "$60",
  "1412",
].join("\n"), "5045550404", "2026-08-12T19:13:00.000Z"));
assert.equal(compactFuel.status, "queued");
assert.equal(compactFuel.record?.time, "2:12 PM");

const singleLineFuel = ingestCrewExpenseText(message(
  "single-line-fuel",
  "Truck 1 Shell 24 gallons $100 212",
  "5045550505",
  "2026-08-12T19:30:24.000Z",
));
assert.equal(singleLineFuel.status, "queued");
assert.equal(singleLineFuel.record?.truck, "Truck# 1");
assert.equal(singleLineFuel.record?.location, "Shell");
assert.equal(singleLineFuel.record?.gallons, 24);
assert.equal(singleLineFuel.record?.cost, 100);
assert.equal(singleLineFuel.record?.time, "2:12 PM");

const shuffledFuel = ingestCrewExpenseText(message(
  "shuffled-fuel",
  "212, $100 / Shell | 24 GAL - TRUCK#1",
  "5045550606",
  "2026-08-12T19:31:00.000Z",
));
assert.equal(shuffledFuel.status, "queued");
assert.equal(shuffledFuel.record?.truck, "Truck# 1");
assert.equal(shuffledFuel.record?.location, "Shell");
assert.equal(shuffledFuel.record?.time, "2:12 PM");

const naturalFuel = ingestCrewExpenseText(message(
  "natural-fuel",
  "Fuel: T1 filled at Shell; gallons 24; paid 100 dollars; time 2:12pm",
  "5045550707",
  "2026-08-12T19:31:00.000Z",
));
assert.equal(naturalFuel.status, "queued");
assert.equal(naturalFuel.record?.truck, "Truck# 1");
assert.equal(naturalFuel.record?.location, "Shell");
assert.equal(naturalFuel.record?.cost, 100);

const shuffledDump = ingestCrewExpenseText(message(
  "shuffled-dump",
  "10:35am | 75 dollars | lbs 2400 | River Birch | T6 | dump",
  "5045550808",
  "2026-08-12T15:36:00.000Z",
));
assert.equal(shuffledDump.status, "queued");
assert.equal(shuffledDump.record?.truck, "Truck# 6");
assert.equal(shuffledDump.record?.location, "River Birch");
assert.equal(shuffledDump.record?.weight, "lbs 2400");
assert.equal(shuffledDump.record?.time, "10:35 AM");

const shuffledSequencePhone = "5045550909";
assert.equal(ingestCrewExpenseText(message("shuffled-sequence-prompt", "Fuel", shuffledSequencePhone, "2026-08-12T19:32:00.000Z")).status, "prompted");
assert.equal(ingestCrewExpenseText(message("shuffled-sequence-time", "212", shuffledSequencePhone, "2026-08-12T19:32:01.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("shuffled-sequence-cost", "$100", shuffledSequencePhone, "2026-08-12T19:32:02.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("shuffled-sequence-location", "Shell", shuffledSequencePhone, "2026-08-12T19:32:03.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("shuffled-sequence-truck", "T1", shuffledSequencePhone, "2026-08-12T19:32:04.000Z")).status, "collecting");
const shuffledSequence = ingestCrewExpenseText(message("shuffled-sequence-gallons", "gal 24", shuffledSequencePhone, "2026-08-12T19:32:05.000Z"));
assert.equal(shuffledSequence.status, "queued");
assert.equal(shuffledSequence.record?.time, "2:12 PM");

const commaFuel = ingestCrewExpenseText(message(
  "comma-fuel",
  "Truck 1, Shell, 24 gallons, $100, 212",
  "5045551010",
  "2026-08-12T19:33:00.000Z",
));
assert.equal(commaFuel.status, "queued");
assert.equal(commaFuel.record?.location, "Shell");

const shortFuel = ingestCrewExpenseText(message(
  "short-fuel",
  "T1 Shell 24g $100 1412",
  "5045551111",
  "2026-08-12T19:33:00.000Z",
));
assert.equal(shortFuel.status, "queued");
assert.equal(shortFuel.record?.truck, "Truck# 1");
assert.equal(shortFuel.record?.gallons, 24);
assert.equal(shortFuel.record?.time, "2:12 PM");

const delayedSequencePhone = "5045551212";
assert.equal(ingestCrewExpenseText(message("delayed-sequence-prompt", "Fuel", delayedSequencePhone, "2026-08-12T13:00:00.000Z")).status, "prompted");
assert.equal(ingestCrewExpenseText(message("delayed-sequence-truck", "Truck 1", delayedSequencePhone, "2026-08-12T13:01:00.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("delayed-sequence-location", "Shell", delayedSequencePhone, "2026-08-12T16:00:00.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("delayed-sequence-cost", "$100", delayedSequencePhone, "2026-08-12T18:00:00.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("delayed-sequence-time", "212", delayedSequencePhone, "2026-08-12T19:00:00.000Z")).status, "collecting");
const delayedSequence = ingestCrewExpenseText(message("delayed-sequence-gallons", "24g", delayedSequencePhone, "2026-08-12T19:34:00.000Z"));
assert.equal(delayedSequence.status, "queued");
assert.equal(delayedSequence.record?.cost, 100);

const weightlessDump = ingestCrewExpenseText(message(
  "weightless-dump",
  "T1 Gentilly 44 310",
  "5045551313",
  "2026-08-12T20:10:08.000Z",
));
assert.equal(weightlessDump.status, "queued");
assert.equal(weightlessDump.record?.kind, "dump");
assert.equal(weightlessDump.record?.truck, "Truck# 1");
assert.equal(weightlessDump.record?.location, "Gentilly");
assert.equal(weightlessDump.record?.cost, 44);
assert.equal(weightlessDump.record?.weight, null);
assert.equal(weightlessDump.record?.time, "3:10 PM");

const shuffledWeightlessDump = ingestCrewExpenseText(message(
  "shuffled-weightless-dump",
  "310, 44 / Gentilly | T1",
  "5045551414",
  "2026-08-12T20:10:08.000Z",
));
assert.equal(shuffledWeightlessDump.status, "queued");
assert.equal(shuffledWeightlessDump.record?.location, "Gentilly");
assert.equal(shuffledWeightlessDump.record?.cost, 44);

const multilineWeightlessDump = ingestCrewExpenseText(message(
  "multiline-weightless-dump",
  "Truck 1\nGentilly\n44\n310",
  "5045551515",
  "2026-08-12T20:10:08.000Z",
));
assert.equal(multilineWeightlessDump.status, "queued");
assert.equal(multilineWeightlessDump.record?.weight, null);

assert.equal(ingestCrewExpenseText(message(
  "truck-arrival-not-expense",
  "T1 arrived Gentilly 310",
  "5045551616",
  "2026-08-12T20:10:08.000Z",
)).status, "ignored");
assert.equal(readCrewExpenseRecords("2026-08-12").length, 0);
assert.equal(queuedCrewExpenseTransactions(20).length, 16);

const transaction = claimCrewExpenseTransaction(queuedCrewExpenseTransactions()[0]);
assert.ok(transaction);
assert.throws(() => finishCrewExpenseTransaction(transaction.file), /before Slack delivery/);
updateCrewExpenseTransaction(transaction.file, { stage: "slack_sent" });
finishCrewExpenseTransaction(transaction.file);
assert.equal(readCrewExpenseRecords("2026-08-12").length, 1);

assert.match(formatCrewExpenseSlackNotification(singleLineFuel.record!), /^Fuel recorded in JunkWare/);
process.env.SLACK_OPSCENTER_ALERTS_ENABLED = "true";
process.env.SLACK_BOT_TOKEN = "xoxb-test";
process.env.SLACK_TRUCK_1_CHANNEL_ID = "C_TRUCK_1";
let slackRequest: Record<string, unknown> = {};
sendCrewExpenseSlackNotification(singleLineFuel.record!, async (_input, init) => {
  slackRequest = JSON.parse(String(init?.body || "{}"));
  return new Response(JSON.stringify({ ok: true, ts: "123.456" }), { status: 200, headers: { "Content-Type": "application/json" } });
}).then((slackDelivery) => {
  assert.equal(slackDelivery.channel, "C_TRUCK_1");
  assert.equal(slackRequest.channel, "C_TRUCK_1");
  assert.match(String(slackRequest.text), /Truck# 1 · Shell · \$100\.00/);
  process.stdout.write(`${JSON.stringify({ ok: true, records: readCrewExpenseRecords().length })}\n`);
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
