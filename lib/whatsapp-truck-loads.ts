import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { addDays, chicagoDateKey } from "@/lib/report-dates";
import {
  formatTruckLoadFraction,
  normalizeTruckLoadLabel,
  parseJunkwareLoadFraction,
  readTruckLoadStatuses,
  recordTruckLoadSnapshot,
  resetTruckLoad,
  type TruckLoadStatus,
} from "@/lib/truck-load-status";
import type { TruckLoadPhotoAnalysis } from "@/lib/truck-load-photo-analysis";
import { enqueueOpsBotReply } from "@/lib/whatsapp-crew-expenses";
import { normalizePhone } from "@/lib/whatsapp-job-photo-matching";
import type { WhatsAppImageMessage, WhatsAppTextMessage } from "@/lib/whatsapp-job-photo-queue";

export type TruckLoadIngestResult = {
  status: "ignored" | "updated" | "reset" | "planned" | "confirmed" | "review" | "duplicate";
  truck?: string;
};

type PendingPhotoEstimate = {
  version: 1;
  sourceMessageId: string;
  senderPhone: string;
  phoneNumberId: string;
  receivedAt: string;
  truck: string;
  analysis: TruckLoadPhotoAnalysis;
  savedAt: string;
};

function clean(value: unknown, maximum = 2_000): string {
  return String(value || "").replace(/[ \t]+/g, " ").trim().slice(0, maximum);
}

function stateDirectory(): string {
  const configured = clean(process.env.WHATSAPP_TRUCK_LOAD_STATE_DIR);
  if (configured) return configured;
  const dataDirectory = clean(process.env.OPSBOT_DATA_DIR);
  if (dataDirectory) return path.join(dataDirectory, "integrations", "whatsapp-truck-loads");
  return path.join(process.cwd(), "data", "integrations", "whatsapp-truck-loads");
}

function pendingDirectory(): string {
  const directory = path.join(stateDirectory(), "pending-photo");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

function recordKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function pendingFile(senderPhone: string): string {
  return path.join(pendingDirectory(), `${recordKey(normalizePhone(senderPhone))}.json`);
}

function writeJsonAtomic(target: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function truckFromText(text: string): string {
  const match = String(text || "").match(/\btruck(?:\s+status)?\s*#?\s*(\d{1,3})\b/i);
  return match ? normalizeTruckLoadLabel(match[1]) : "";
}

function loadFromLine(line: string): number | null {
  const percent = line.match(/\b(\d{1,3}(?:\.\d+)?)\s*%/);
  if (percent) {
    const value = Number(percent[1]) / 100;
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  }
  if (!/(?:\b(?:empty|minimum|full)\b|\d+\s*\/\s*\d+)/i.test(line)) return null;
  return parseJunkwareLoadFraction(line);
}

function parseSnapshot(text: string): { truck: string; loadFraction: number | null; contents: string; recognized: boolean } {
  const lines = String(text || "").split(/\r?\n/).map((line) => clean(line, 500)).filter(Boolean);
  const truck = truckFromText(text);
  const loadLine = lines.find((line) => loadFromLine(line) !== null) || "";
  const loadFraction = loadLine ? loadFromLine(loadLine) : null;
  const contents = lines
    .filter((line) => line !== loadLine)
    .filter((line) => !truckFromText(line))
    .filter((line) => !/^(?:truck|load)\s+status\s*:?!?$/i.test(line))
    .map((line) => line.replace(/^contents?\s*:\s*/i, ""))
    .join("; ")
    .slice(0, 500);
  return { truck, loadFraction, contents, recognized: Boolean(truck && (loadLine || /\b(?:truck|load)\s+status\b/i.test(text))) };
}

function contentsKind(contents: string): "junk" | "metal" | "mixed" | "unknown" {
  const value = contents.toLowerCase();
  const metal = /\b(?:metal|scrap|steel|iron|aluminum|copper)\b/.test(value);
  const junk = /\b(?:junk|trash|garbage|furniture|mattress|debris|yard|household|appliance)\b/.test(value);
  if (metal && junk) return "mixed";
  if (metal) return "metal";
  if (junk) return "junk";
  return "unknown";
}

export function formatTruckConsolidationPlan(date: string, statuses: TruckLoadStatus[]): string {
  const nextMorning = addDays(date, 1);
  const loaded = statuses.filter((status) => status.currentLoadFraction > 1 / 48);
  const lines = [`Morning consolidation plan — ${nextMorning}`, "", `End-of-day inventory (${date}):`];
  if (!loaded.length) return [...lines, "- All recorded trucks are empty.", "", "No consolidation is needed."].join("\n");
  for (const status of loaded) {
    lines.push(`- ${status.truck}: ${status.currentLoadLabel}${status.currentContents ? ` — ${status.currentContents}` : " — contents not recorded"}`);
  }

  const actions: string[] = [];
  for (const kind of ["junk", "metal"] as const) {
    const working = loaded
      .filter((status) => contentsKind(status.currentContents) === kind && status.currentLoadFraction < 1)
      .map((status) => ({ truck: status.truck, load: status.currentLoadFraction }))
      .sort((left, right) => right.load - left.load);
    while (working.length > 1) {
      let receiverIndex = -1;
      let donorIndex = -1;
      for (let index = 0; index < working.length - 1 && donorIndex < 0; index += 1) {
        const compatibleDonor = [...working.keys()]
          .slice(index + 1)
          .reverse()
          .find((candidate) => working[index].load + working[candidate].load <= 1 + 1 / 48);
        if (compatibleDonor !== undefined) {
          receiverIndex = index;
          donorIndex = compatibleDonor;
        }
      }
      if (receiverIndex < 0 || donorIndex < 0) break;
      const receiver = working[receiverIndex];
      const donor = working[donorIndex];
      const donorLoad = donor.load;
      receiver.load += donor.load;
      donor.load = 0;
      actions.push(`Move ${donor.truck}'s ${formatTruckLoadFraction(donorLoad)} ${kind} load into ${receiver.truck}; ${receiver.truck} becomes ${formatTruckLoadFraction(receiver.load)}.`);
      working.splice(donorIndex, 1);
      working.sort((left, right) => right.load - left.load);
    }
  }
  for (const status of loaded.filter((entry) => contentsKind(entry.currentContents) === "mixed")) {
    actions.push(`Sort ${status.truck}'s mixed load first; route the metal separately before combining its junk.`);
  }
  for (const status of loaded.filter((entry) => contentsKind(entry.currentContents) === "unknown")) {
    actions.push(`Verify ${status.truck}'s contents before moving its load.`);
  }
  for (const status of loaded.filter((entry) => entry.currentLoadFraction >= 1)) {
    const kind = contentsKind(status.currentContents);
    actions.push(`${status.truck} is ${status.currentLoadLabel}; schedule ${kind === "metal" ? "the metal yard" : "the dump"} before assigning more pickups.`);
  }
  lines.push("", "Proposed moves:");
  if (actions.length) actions.forEach((action, index) => lines.push(`${index + 1}. ${action}`));
  else lines.push("- No safe same-stream consolidation is identified from the recorded loads.");
  lines.push("", "Dispatcher must confirm material compatibility, safe transfer conditions, and crew assignments before any move.");
  return lines.join("\n").slice(0, 4_000);
}

function readPendingPhoto(senderPhone: string, receivedAt: string): PendingPhotoEstimate | null {
  try {
    const pending = JSON.parse(fs.readFileSync(pendingFile(senderPhone), "utf8")) as PendingPhotoEstimate;
    const messageTime = new Date(receivedAt).getTime();
    const savedTime = new Date(pending.savedAt).getTime();
    if (pending.version !== 1 || !Number.isFinite(messageTime) || !Number.isFinite(savedTime) || messageTime - savedTime > 12 * 60 * 60 * 1_000) return null;
    return pending;
  } catch {
    return null;
  }
}

export function truckLoadPhotoRequest(message: WhatsAppImageMessage, recentText: string): { truck: string } | null {
  const context = [message.caption, recentText].filter(Boolean).join("\n");
  if (!/\b(?:truck|load)\s+status\b|\b(?:check|estimate)\s+(?:this\s+)?truck(?:\s+load)?\b|\bhow\s+full\b/i.test(context)) return null;
  const truck = truckFromText(context);
  return truck ? { truck } : null;
}

export function recordTruckLoadPhotoAnalysis(message: WhatsAppImageMessage, truck: string, analysis: TruckLoadPhotoAnalysis): void {
  const normalizedTruck = normalizeTruckLoadLabel(truck);
  if (!normalizedTruck) throw new Error("The truck-status photo does not identify a truck.");
  if (!analysis.visibleEnough || analysis.confidence < 0.45) {
    enqueueOpsBotReply(message, [
      `I couldn't confidently estimate ${normalizedTruck} from that photo.`,
      analysis.notes ? `Reason: ${analysis.notes}` : "The cargo area was not clear enough.",
      "Send a clear photo showing the full cargo area, or enter:",
      `${normalizedTruck.replace("# ", " ")}\n1/2 truck\nsome metal, mostly junk`,
    ].join("\n"), "truck-load-photo-review");
    return;
  }
  const pending: PendingPhotoEstimate = {
    version: 1,
    sourceMessageId: message.messageId,
    senderPhone: message.senderPhone,
    phoneNumberId: message.phoneNumberId,
    receivedAt: message.receivedAt,
    truck: normalizedTruck,
    analysis,
    savedAt: new Date().toISOString(),
  };
  writeJsonAtomic(pendingFile(message.senderPhone), pending);
  enqueueOpsBotReply(message, [
    `${normalizedTruck} photo estimate: ${formatTruckLoadFraction(analysis.loadFraction)}.`,
    `Contents: ${analysis.contents}.`,
    `Confidence: ${Math.round(analysis.confidence * 100)}%.`,
    analysis.notes ? `Note: ${analysis.notes}` : "",
    "",
    `Reply CONFIRM ${normalizedTruck.replace("Truck# ", "TRUCK ")} to update the truck status, or send the correct load manually.`,
  ].filter(Boolean).join("\n"), "truck-load-photo-estimate");
}

export function ingestTruckLoadText(message: WhatsAppTextMessage): TruckLoadIngestResult {
  const text = clean(message.text);
  const date = chicagoDateKey(new Date(message.receivedAt));
  const confirm = text.match(/^confirm\s+(?:truck\s*#?\s*)?(\d{1,3})\s*$/i);
  if (confirm) {
    const pending = readPendingPhoto(message.senderPhone, message.receivedAt);
    if (!pending || pending.truck !== normalizeTruckLoadLabel(confirm[1])) return { status: "ignored" };
    const result = recordTruckLoadSnapshot({
      date,
      truck: pending.truck,
      loadFraction: pending.analysis.loadFraction,
      contents: pending.analysis.contents,
      messageId: `photo:${pending.sourceMessageId}`,
      occurredAt: pending.receivedAt,
      recordedBy: "OpsBot confirmed photo estimate",
    });
    enqueueOpsBotReply(message, `${pending.truck} updated to ${result.status.currentLoadLabel} — ${result.status.currentContents}.`, "truck-load-photo-confirmed");
    return { status: result.created ? "confirmed" : "duplicate", truck: pending.truck };
  }

  if (/^(?:create\s+|show\s+|send\s+)?(?:the\s+)?(?:morning\s+|tomorrow(?:'s)?\s+|next[- ]morning\s+)?consolidation\s+plan\s*$/i.test(text)) {
    const plan = formatTruckConsolidationPlan(date, readTruckLoadStatuses(date));
    enqueueOpsBotReply(message, plan, "truck-consolidation-plan");
    return { status: "planned" };
  }

  const truck = truckFromText(text);
  const isExpense = /\$|\b(?:cost|weight|tons?|pounds?|location|landfill)\b/i.test(text);
  const resetLocation = /\bmetal\s+yard\b/i.test(text) ? "metal_yard" : /\b(?:dumped|emptied\s+at\s+(?:the\s+)?dump|dump\s+complete)\b/i.test(text) ? "dump" : "";
  if (truck && resetLocation && !isExpense) {
    const status = resetTruckLoad({ date, truck, location: resetLocation, recordedBy: "OpsBot", occurredAt: message.receivedAt, eventId: `opsbot:${message.messageId}` });
    enqueueOpsBotReply(message, `${truck} reset to Empty at the ${resetLocation === "metal_yard" ? "metal yard" : "dump"}.`, "truck-load-reset");
    return { status: "reset", truck: status.truck };
  }

  const snapshot = parseSnapshot(text);
  if (!snapshot.recognized) return { status: "ignored" };
  if (snapshot.loadFraction === null || !snapshot.contents) {
    enqueueOpsBotReply(message, [
      "Send a photo captioned with the truck status, or enter truck number, current load size, and contents:",
      "Truck status 9",
      "",
      "Manual format:",
      "Truck 9",
      "1/2 truck",
      "some metal, mostly junk",
    ].join("\n"), "truck-load-review");
    return { status: "review", truck: snapshot.truck || undefined };
  }
  const result = recordTruckLoadSnapshot({
    date,
    truck: snapshot.truck,
    loadFraction: snapshot.loadFraction,
    contents: snapshot.contents,
    messageId: message.messageId,
    occurredAt: message.receivedAt,
    recordedBy: "OpsBot manual status",
  });
  try { fs.unlinkSync(pendingFile(message.senderPhone)); } catch {}
  enqueueOpsBotReply(message, `${result.status.truck} recorded at ${result.status.currentLoadLabel} — ${result.status.currentContents}.`, "truck-load-recorded");
  return { status: result.created ? "updated" : "duplicate", truck: result.status.truck };
}

export function recordTruckLoadPhotoFailure(message: WhatsAppImageMessage, truck: string, error: unknown): void {
  void error;
  enqueueOpsBotReply(message, [
    `${normalizeTruckLoadLabel(truck)} photo estimate could not be completed.`,
    "Enter the status manually:",
    `${normalizeTruckLoadLabel(truck).replace("Truck# ", "Truck ")}\n1/2 truck\nsome metal, mostly junk`,
  ].join("\n"), "truck-load-photo-failed");
}
