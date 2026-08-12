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

const freeformFuelPhone = "5045550202";
assert.equal(ingestCrewExpenseText(message("freeform-fuel-prompt", "Fuel", freeformFuelPhone, "2026-08-12T19:10:00.000Z")).status, "prompted");
assert.equal(ingestCrewExpenseText(message("freeform-fuel-truck", "Truck 1", freeformFuelPhone, "2026-08-12T19:11:00.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("freeform-fuel-location", "Shell", freeformFuelPhone, "2026-08-12T19:11:10.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("freeform-fuel-gallons", "24 gallons", freeformFuelPhone, "2026-08-12T19:11:20.000Z")).status, "collecting");
assert.equal(ingestCrewExpenseText(message("freeform-fuel-cost", "$100.", freeformFuelPhone, "2026-08-12T19:11:30.000Z")).status, "collecting");
const freeformFuel = ingestCrewExpenseText(message("freeform-fuel-time", "212", freeformFuelPhone, "2026-08-12T19:12:00.000Z"));
assert.equal(freeformFuel.status, "recorded");
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
assert.equal(freeformDump.status, "recorded");
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
assert.equal(compactFuel.status, "recorded");
assert.equal(compactFuel.record?.time, "2:12 PM");
assert.equal(readCrewExpenseRecords("2026-08-12").length, 5);

process.stdout.write(`${JSON.stringify({ ok: true, records: readCrewExpenseRecords().length })}\n`);
