import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chicagoDateKey } from "@/lib/report-dates";
import { normalizePhone } from "@/lib/whatsapp-job-photo-matching";
import type { WhatsAppTextMessage } from "@/lib/whatsapp-job-photo-queue";

export type CrewExpenseKind = "dump" | "fuel";

export type CrewExpenseRecord = {
  version: 1;
  messageId: string;
  kind: CrewExpenseKind;
  date: string;
  truck: string;
  location: string;
  cost: number;
  weight: string | null;
  gallons: number | null;
  time: string;
  reportedAt: string;
  senderHash: string;
  source: "whatsapp_opsbot";
};

export type CrewExpenseIngestResult = {
  status: "ignored" | "duplicate" | "prompted" | "recorded" | "review";
  kind?: CrewExpenseKind;
  record?: CrewExpenseRecord;
  missing?: string[];
};

type CrewExpenseReply = {
  version: 1;
  messageId: string;
  recipient: string;
  phoneNumberId: string;
  text: string;
  enqueuedAt: string;
  attempts?: number;
};

const DUMP_TEMPLATE = [
  "Dump",
  "Truck #:",
  "Location:",
  "Cost:",
  "Weight:",
  "Time:",
].join("\n");

const FUEL_TEMPLATE = [
  "Fuel",
  "Truck #:",
  "Location:",
  "Cost:",
  "Gallons:",
  "Time:",
].join("\n");

function clean(value: unknown): string {
  return String(value || "").replace(/[ \t]+/g, " ").trim();
}

function recordKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stateDirectory(): string {
  const configured = clean(process.env.WHATSAPP_CREW_EXPENSE_STATE_DIR);
  if (configured) return configured;
  const dataDirectory = clean(process.env.OPSBOT_DATA_DIR);
  if (dataDirectory) return path.join(dataDirectory, "integrations", "whatsapp-crew-expenses");
  return path.join(process.cwd(), "data", "integrations", "whatsapp-crew-expenses");
}

function directory(name: "messages" | "records" | "review" | "sessions" | "outbox-incoming" | "outbox-processing" | "outbox-sent" | "outbox-failed"): string {
  return path.join(stateDirectory(), name);
}

function ensureDirectories(): void {
  for (const name of ["messages", "records", "review", "sessions", "outbox-incoming", "outbox-processing", "outbox-sent", "outbox-failed"] as const) {
    fs.mkdirSync(directory(name), { recursive: true, mode: 0o700 });
  }
}

function writeJsonAtomic(target: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function messageFile(messageId: string): string {
  return path.join(directory("messages"), `${recordKey(messageId)}.json`);
}

function normalizeTruck(value: string): string | null {
  const match = clean(value).match(/^(?:truck\s*#?\s*)?(\d{1,3})$/i);
  if (!match) return null;
  const number = Number(match[1]);
  return number > 0 ? `Truck# ${number}` : null;
}

function parseMoney(value: string): number | null {
  const normalized = clean(value).replace(/^\$\s*/, "").replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 && amount <= 25_000 ? Math.round(amount * 100) / 100 : null;
}

function parseGallons(value: string): number | null {
  const normalized = clean(value).replace(/\s*(?:gal(?:lon)?s?)\.?$/i, "");
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return null;
  const gallons = Number(normalized);
  return Number.isFinite(gallons) && gallons > 0 && gallons <= 500 ? gallons : null;
}

function parseTime(value: string): string | null {
  const normalized = clean(value).toUpperCase().replace(/\s+/g, " ");
  const twelveHour = normalized.match(/^(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([AP]M)$/);
  if (twelveHour) return `${Number(twelveHour[1])}:${twelveHour[2] || "00"} ${twelveHour[3]}`;
  const twentyFourHour = normalized.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!twentyFourHour) return null;
  const hour = Number(twentyFourHour[1]);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${twentyFourHour[2]} ${suffix}`;
}

function commandKind(text: string): CrewExpenseKind | null {
  const command = clean(text).toLowerCase();
  if (/^dump(?:\s+(?:run|expense))?$/.test(command)) return "dump";
  if (/^(?:fuel|gas)(?:\s+(?:fill-?up|expense))?$/.test(command)) return "fuel";
  return null;
}

function messageHeading(lines: string[]): CrewExpenseKind | null {
  if (!lines.length) return null;
  const first = clean(lines[0]).toLowerCase();
  if (first === "dump") return "dump";
  if (first === "fuel" || first === "gas") return "fuel";
  return null;
}

function fieldsFromMessage(text: string): { fields: Record<string, string>; recognized: boolean; lines: string[] } {
  const fields: Record<string, string> = {};
  const lines = String(text || "").split(/\r?\n/).map(clean).filter(Boolean);
  let recognized = false;
  for (const line of lines) {
    const match = line.match(/^(truck\s*#?|location|cost|weight|gallons?|time)\s*:\s*(.*)$/i);
    if (!match) continue;
    const rawKey = match[1].toLowerCase().replace(/\s+/g, "");
    const key = rawKey === "truck#" || rawKey === "truck"
      ? "truck"
      : rawKey.startsWith("gallon")
        ? "gallons"
        : rawKey;
    fields[key] = clean(match[2]);
    recognized = true;
  }
  return { fields, recognized, lines };
}

function sessionFile(senderPhone: string): string {
  return path.join(directory("sessions"), `${recordKey(normalizePhone(senderPhone))}.json`);
}

function activeSession(senderPhone: string, receivedAt: string): CrewExpenseKind | null {
  try {
    const payload = JSON.parse(fs.readFileSync(sessionFile(senderPhone), "utf8")) as { kind?: unknown; openedAt?: unknown };
    const openedAt = new Date(String(payload.openedAt || "")).getTime();
    const messageAt = new Date(receivedAt).getTime();
    if (!Number.isFinite(openedAt) || !Number.isFinite(messageAt) || messageAt < openedAt - 60_000 || messageAt - openedAt > 30 * 60_000) return null;
    return payload.kind === "dump" || payload.kind === "fuel" ? payload.kind : null;
  } catch {
    return null;
  }
}

function openSession(message: WhatsAppTextMessage, kind: CrewExpenseKind): void {
  writeJsonAtomic(sessionFile(message.senderPhone), { version: 1, kind, openedAt: message.receivedAt });
}

function closeSession(senderPhone: string): void {
  try { fs.unlinkSync(sessionFile(senderPhone)); } catch { /* no active session */ }
}

function enqueueReply(message: WhatsAppTextMessage, text: string): void {
  const recipient = normalizePhone(message.senderPhone);
  if (!recipient) return;
  const reply: CrewExpenseReply = {
    version: 1,
    messageId: message.messageId,
    recipient,
    phoneNumberId: clean(message.phoneNumberId),
    text: String(text).slice(0, 4_000),
    enqueuedAt: new Date().toISOString(),
  };
  writeJsonAtomic(path.join(directory("outbox-incoming"), `${recordKey(message.messageId)}.json`), reply);
}

function missingReply(kind: CrewExpenseKind, missing: string[], invalid: string[]): string {
  const problems = [
    ...(missing.length ? [`Missing: ${missing.join(", ")}.`] : []),
    ...(invalid.length ? [`Check: ${invalid.join(", ")}.`] : []),
  ].join(" ");
  const guidance = kind === "dump"
    ? "Weight is optional. Use AM/PM or 24-hour time."
    : "Gallons is required. Use AM/PM or 24-hour time.";
  return `${problems} ${guidance}\n\n${kind === "dump" ? DUMP_TEMPLATE : FUEL_TEMPLATE}`.trim();
}

export function ingestCrewExpenseText(message: WhatsAppTextMessage): CrewExpenseIngestResult {
  ensureDirectories();
  const marker = messageFile(message.messageId);
  if (fs.existsSync(marker)) return { status: "duplicate" };

  const command = commandKind(message.text);
  if (command) {
    openSession(message, command);
    enqueueReply(message, `${command === "dump" ? "Dump" : "Fuel"} expense form:\n\n${command === "dump" ? DUMP_TEMPLATE : FUEL_TEMPLATE}${command === "dump" ? "\n\nWeight is optional." : ""}`);
    writeJsonAtomic(marker, { version: 1, messageId: message.messageId, outcome: "prompted", kind: command, processedAt: new Date().toISOString() });
    return { status: "prompted", kind: command };
  }

  const parsed = fieldsFromMessage(message.text);
  if (!parsed.recognized) return { status: "ignored" };
  const heading = messageHeading(parsed.lines);
  const inferred = parsed.fields.gallons ? "fuel" : parsed.fields.weight ? "dump" : null;
  const kind = heading || activeSession(message.senderPhone, message.receivedAt) || inferred;
  if (!kind) {
    const detail = "Start with Dump or Fuel so OpsBot knows which expense form you are sending.";
    enqueueReply(message, `${detail}\n\nSend Dump or Fuel to get the form.`);
    writeJsonAtomic(path.join(directory("review"), `${recordKey(message.messageId)}.json`), {
      version: 1, messageId: message.messageId, reason: "expense_type_missing", reportedAt: message.receivedAt,
    });
    writeJsonAtomic(marker, { version: 1, messageId: message.messageId, outcome: "review", reason: "expense_type_missing", processedAt: new Date().toISOString() });
    return { status: "review" };
  }

  const required = kind === "dump" ? ["truck", "location", "cost", "time"] : ["truck", "location", "cost", "gallons", "time"];
  const missing = required.filter((key) => !parsed.fields[key]);
  const truck = parsed.fields.truck ? normalizeTruck(parsed.fields.truck) : null;
  const cost = parsed.fields.cost ? parseMoney(parsed.fields.cost) : null;
  const gallons = kind === "fuel" && parsed.fields.gallons ? parseGallons(parsed.fields.gallons) : null;
  const time = parsed.fields.time ? parseTime(parsed.fields.time) : null;
  const invalid = [
    ...(parsed.fields.truck && !truck ? ["Truck #"] : []),
    ...(parsed.fields.location && (parsed.fields.location.length < 2 || parsed.fields.location.length > 120) ? ["Location"] : []),
    ...(parsed.fields.cost && cost === null ? ["Cost"] : []),
    ...(kind === "fuel" && parsed.fields.gallons && gallons === null ? ["Gallons"] : []),
    ...(parsed.fields.time && !time ? ["Time"] : []),
  ];

  if (missing.length || invalid.length || !truck || cost === null || !time || (kind === "fuel" && gallons === null)) {
    const reply = missingReply(kind, missing.map((key) => key === "truck" ? "Truck #" : key[0].toUpperCase() + key.slice(1)), invalid);
    enqueueReply(message, reply);
    writeJsonAtomic(path.join(directory("review"), `${recordKey(message.messageId)}.json`), {
      version: 1, messageId: message.messageId, kind, reason: "invalid_or_incomplete_form", missing, invalid,
      reportedAt: message.receivedAt, senderHash: recordKey(normalizePhone(message.senderPhone)),
    });
    writeJsonAtomic(marker, { version: 1, messageId: message.messageId, outcome: "review", kind, processedAt: new Date().toISOString() });
    return { status: "review", kind, missing };
  }

  const record: CrewExpenseRecord = {
    version: 1,
    messageId: message.messageId,
    kind,
    date: chicagoDateKey(new Date(message.receivedAt)),
    truck,
    location: parsed.fields.location,
    cost,
    weight: kind === "dump" ? clean(parsed.fields.weight) || null : null,
    gallons: kind === "fuel" ? gallons : null,
    time,
    reportedAt: message.receivedAt,
    senderHash: recordKey(normalizePhone(message.senderPhone)),
    source: "whatsapp_opsbot",
  };
  writeJsonAtomic(path.join(directory("records"), `${recordKey(message.messageId)}.json`), record);
  const detail = kind === "dump"
    ? `${record.weight ? ` · ${record.weight}` : " · no weight"}`
    : ` · ${record.gallons} gal`;
  enqueueReply(message, `${kind === "dump" ? "Dump" : "Fuel"} recorded for Truck Records — ${record.truck} · ${record.location} · $${record.cost.toFixed(2)}${detail} · ${record.time}`);
  writeJsonAtomic(marker, { version: 1, messageId: message.messageId, outcome: "recorded", kind, processedAt: new Date().toISOString() });
  closeSession(message.senderPhone);
  return { status: "recorded", kind, record };
}

export function readCrewExpenseRecords(date?: string): CrewExpenseRecord[] {
  ensureDirectories();
  return fs.readdirSync(directory("records"))
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .flatMap((name) => {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(directory("records"), name), "utf8")) as CrewExpenseRecord;
        return !date || record.date === date ? [record] : [];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.reportedAt.localeCompare(left.reportedAt));
}

export function queuedCrewExpenseReplies(limit = 20): string[] {
  ensureDirectories();
  return fs.readdirSync(directory("outbox-incoming"))
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .sort()
    .slice(0, Math.max(0, limit))
    .map((name) => path.join(directory("outbox-incoming"), name));
}

export function claimCrewExpenseReply(incomingFile: string): { file: string; reply: CrewExpenseReply } | null {
  ensureDirectories();
  const base = path.basename(incomingFile);
  if (!/^[a-f0-9]{64}\.json$/.test(base)) return null;
  const processingFile = path.join(directory("outbox-processing"), base);
  try {
    fs.renameSync(incomingFile, processingFile);
    return { file: processingFile, reply: JSON.parse(fs.readFileSync(processingFile, "utf8")) as CrewExpenseReply };
  } catch {
    return null;
  }
}

export function finishCrewExpenseReply(processingFile: string, outcome: "sent" | "failed", details: Record<string, unknown>): void {
  const current = JSON.parse(fs.readFileSync(processingFile, "utf8"));
  const target = path.join(directory(outcome === "sent" ? "outbox-sent" : "outbox-failed"), path.basename(processingFile));
  writeJsonAtomic(target, { ...current, outcome, outcomeAt: new Date().toISOString(), ...details });
  fs.unlinkSync(processingFile);
}

export function requeueCrewExpenseReply(processingFile: string, errorMessage: string, maxAttempts = 5): boolean {
  const current = JSON.parse(fs.readFileSync(processingFile, "utf8")) as CrewExpenseReply;
  const attempts = Math.max(0, Number(current.attempts) || 0) + 1;
  if (attempts >= maxAttempts) {
    finishCrewExpenseReply(processingFile, "failed", { attempts, error: clean(errorMessage).slice(0, 500) });
    return false;
  }
  writeJsonAtomic(path.join(directory("outbox-incoming"), path.basename(processingFile)), {
    ...current, attempts, lastAttemptAt: new Date().toISOString(), lastError: clean(errorMessage).slice(0, 500),
  });
  fs.unlinkSync(processingFile);
  return true;
}

export function crewExpenseQueueCounts(): { records: number; review: number; replies: number; replyFailures: number } {
  ensureDirectories();
  const count = (name: Parameters<typeof directory>[0]) => fs.readdirSync(directory(name)).filter((entry) => entry.endsWith(".json")).length;
  return { records: count("records"), review: count("review"), replies: count("outbox-incoming"), replyFailures: count("outbox-failed") };
}

export const crewExpenseTemplates = { dump: DUMP_TEMPLATE, fuel: FUEL_TEMPLATE } as const;
