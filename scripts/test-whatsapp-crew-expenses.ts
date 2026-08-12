import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  claimCrewExpenseReply,
  crewExpenseTemplates,
  ingestCrewExpenseText,
  queuedCrewExpenseReplies,
  readCrewExpenseRecords,
} from "@/lib/whatsapp-crew-expenses";
import type { WhatsAppTextMessage } from "@/lib/whatsapp-job-photo-queue";

const state = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-crew-expenses-"));
process.env.WHATSAPP_CREW_EXPENSE_STATE_DIR = state;

function message(messageId: string, text: string): WhatsAppTextMessage {
  return {
    messageId,
    senderPhone: "5045550101",
    receivedAt: "2026-08-12T15:00:00.000Z",
    phoneNumberId: "12345",
    text,
  };
}

assert.equal(crewExpenseTemplates.dump, "Dump\nTruck #:\nLocation:\nCost:\nWeight:\nTime:");
assert.equal(crewExpenseTemplates.fuel, "Fuel\nTruck #:\nLocation:\nCost:\nGallons:\nTime:");

const prompt = ingestCrewExpenseText(message("prompt-dump", "Dump"));
assert.equal(prompt.status, "prompted");
assert.equal(queuedCrewExpenseReplies().length, 1);
const promptReply = claimCrewExpenseReply(queuedCrewExpenseReplies()[0]);
assert.ok(promptReply);
assert.match(promptReply.reply.text, /Weight is optional/);
assert.match(promptReply.reply.text, /Truck #:/);

const dump = ingestCrewExpenseText(message("dump-1", [
  "Dump",
  "Truck #: 8",
  "Location: Gentilly Landfill",
  "Cost: $ 86.40",
  "Weight:",
  "Time: 10:35 AM",
].join("\n")));
assert.equal(dump.status, "recorded");
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
assert.equal(fuel.status, "recorded");
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
assert.equal(readCrewExpenseRecords("2026-08-12").length, 2);
assert.equal(ingestCrewExpenseText(message("fuel-1", "Fuel")).status, "duplicate");

const ordinary = ingestCrewExpenseText(message("ordinary", "JK4049525 after photos"));
assert.equal(ordinary.status, "ignored");
assert.equal(readCrewExpenseRecords("2026-08-13").length, 0);

process.stdout.write(`${JSON.stringify({ ok: true, records: readCrewExpenseRecords().length })}\n`);
