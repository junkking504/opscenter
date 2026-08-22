import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { money as formatMoney } from "@/lib/money";
import { addDays, chicagoDateKey } from "@/lib/report-dates";
import { readMetrics, type AnyRecord } from "@/lib/opsData";
import { enqueueOpsBotReply } from "@/lib/whatsapp-crew-expenses";
import {
  extractJkNumber,
  normalizeJkNumber,
  normalizePhone,
  normalizeTruck,
} from "@/lib/whatsapp-job-photo-matching";
import type { WhatsAppTextMessage } from "@/lib/whatsapp-job-photo-queue";

export type JobCloseoutChargeDefinition = {
  key: string;
  label: string;
  aliases: string[];
  defaultUnitPrice?: number;
  percentage?: number;
};

export const JOB_CLOSEOUT_CHARGES: JobCloseoutChargeDefinition[] = [
  { key: "labor", label: "Labor", aliases: ["labor", "labour"], defaultUnitPrice: 75 },
  { key: "refrigerator", label: "Refrigerator", aliases: ["refrigerators", "refrigerator", "fridges", "fridge"], defaultUnitPrice: 128 },
  { key: "mattress_box_spring", label: "Mattress/Box Spring", aliases: ["mattresses/box springs", "mattress/box spring", "mattress and box spring", "box springs", "box spring", "mattresses", "mattress"], defaultUnitPrice: 30 },
  { key: "tire", label: "Tire", aliases: ["tires", "tire"], defaultUnitPrice: 20 },
  { key: "e_waste", label: "E-Waste", aliases: ["e-waste", "e waste"], defaultUnitPrice: 30 },
  { key: "misc", label: "Misc", aliases: ["miscellaneous", "misc"], defaultUnitPrice: 0 },
  { key: "sofa_couch", label: "Sofa/Couch", aliases: ["sofas/couches", "sofa/couch", "sofas", "sofa", "couches", "couch"], defaultUnitPrice: 128 },
  { key: "sleeper_sofa_couch", label: "Sleeper Sofa/Couch", aliases: ["sleeper sofas/couches", "sleeper sofa/couch", "sleeper sofas", "sleeper sofa", "sleeper couches", "sleeper couch"], defaultUnitPrice: 158 },
  { key: "commercial_refrigerator", label: "Commercial Refrigerator", aliases: ["commercial refrigerators", "commercial refrigerator", "commercial fridges", "commercial fridge"], defaultUnitPrice: 158 },
  { key: "hot_tub", label: "Hot Tub", aliases: ["hot tubs", "hot tub", "hottubs", "hottub"], defaultUnitPrice: 0 },
  { key: "piano", label: "Piano", aliases: ["pianos", "piano"], defaultUnitPrice: 200 },
  { key: "freon_appliance", label: "Freon Appliance", aliases: ["freon appliances", "freon appliance", "freon"], defaultUnitPrice: 30 },
  { key: "microwave", label: "Microwave", aliases: ["microwaves", "microwave"], defaultUnitPrice: 30 },
  { key: "tvs_electronics", label: "TVs/Electronics", aliases: ["tvs/electronics", "tv/electronics", "electronics", "tvs", "tv"], defaultUnitPrice: 30 },
  { key: "gas_surcharge", label: "Gas Surcharge", aliases: ["gas surcharge", "fuel surcharge"], defaultUnitPrice: 20 },
  { key: "cc_surcharge_card_present", label: "CC Surcharge (Card Present)", aliases: ["cc surcharge card present", "credit card fee", "card fee", "cc fee", "credit card surcharge", "card surcharge"], percentage: 3 },
];

const JOB_CATEGORIES = [
  "Appliance Removal",
  "Construction Debris",
  "Dumpster Bag",
  "Dumpster Rental",
  "Foreclosure Cleanout",
  "Furniture Removal",
  "Garage Cleanout",
  "Hoarder Cleanout",
  "Hot Tub Removal",
  "House Cleanout",
  "Mattress Removal",
  "Office Cleanout",
  "Property Cleanout",
  "Yard Cleanup",
] as const;

type EnteredCharge = {
  key: string;
  label: string;
  quantity: number;
  unitPrice: number | null;
  total: number | null;
  percentage: number | null;
};

type EnteredPayment = {
  method: "Billed" | "Cash" | "Credit Card" | "Check";
  amount: number;
  checkNumber: string | null;
  cardLastFour: string | null;
};

export type JobCloseoutPlan = {
  version: 1;
  jkNumber: string;
  appointmentId: string;
  date: string;
  truck: string;
  load: { quantity: number; size: string; price: number } | null;
  bedload: { quantity: number; size: string; price: number } | null;
  charges: EnteredCharge[];
  discount: number;
  tip: number;
  category: string;
  startTime: string;
  endTime: string;
  payments: EnteredPayment[];
  chargesSubtotal: number;
  creditCardFee: number;
  jobTotal: number;
  paymentTotal: number;
  paymentReconciles: boolean;
  sourceMessageIds: string[];
  senderHash: string;
  createdAt: string;
  mode: "shadow";
};

export type JobCloseoutIngestResult = {
  status: "ignored" | "duplicate" | "prompted" | "collecting" | "preview" | "review" | "canceled" | "shadow_confirmed";
  plan?: JobCloseoutPlan;
  missing?: string[];
};

type CloseoutSession = {
  version: 1;
  jkNumber: string;
  appointmentId: string;
  date: string;
  truck: string;
  openedAt: string;
  updatedAt: string;
  textBlocks: string[];
  messageIds: string[];
};

const SESSION_MAX_IDLE_MS = 30 * 60 * 1_000;

function clean(value: unknown): string {
  return String(value || "").replace(/[ \t]+/g, " ").trim();
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function recordKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stateDirectory(): string {
  const configured = clean(process.env.WHATSAPP_JOB_CLOSEOUT_STATE_DIR);
  if (configured) return configured;
  const dataDirectory = clean(process.env.OPSBOT_DATA_DIR);
  if (dataDirectory) return path.join(dataDirectory, "integrations", "whatsapp-job-closeouts");
  return path.join(process.cwd(), "data", "integrations", "whatsapp-job-closeouts");
}

function directory(name: "messages" | "sessions" | "pending" | "shadow-confirmed" | "review"): string {
  return path.join(stateDirectory(), name);
}

function ensureDirectories(): void {
  for (const name of ["messages", "sessions", "pending", "shadow-confirmed", "review"] as const) {
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

function senderFile(queue: "sessions" | "pending", senderPhone: string): string {
  return path.join(directory(queue), `${recordKey(normalizePhone(senderPhone))}.json`);
}

function normalizedWords(value: string): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9%]+/g, " ").replace(/\s+/g, " ").trim();
}

function parseAmount(value: string): number | null {
  const match = String(value).match(/\$\s*([0-9][\d,]*(?:\.\d{1,2})?)/);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000 ? money(amount) : null;
}

export function jobCloseoutTemplate(): string {
  return [
    "JK Number:",
    "Truck Load:",
    "Bedload:",
    "Items:",
    "CC Fee:",
    "Discount:",
    "Tip:",
    "Start Time:",
    "End Time:",
    "Payment:",
  ].join("\n");
}

function closeoutIntent(text: string): boolean {
  const normalized = normalizedWords(text);
  return /^(?:job )?closeout$/.test(normalized)
    || /\b(?:close|closeout|close out)\b/.test(normalized) && Boolean(extractJkNumber(text));
}

function cancelIntent(text: string): boolean {
  return /^(?:cancel|stop)(?:\s+(?:job\s+)?closeout)?$/i.test(clean(text));
}

function confirmationJk(text: string): string {
  return /^confirm\s+(JK\s*[-#:]*\s*\d{4,12})\s*$/i.test(clean(text)) ? extractJkNumber(text) : "";
}

function truckPhoneMap(): Record<string, string> {
  let raw = clean(process.env.WHATSAPP_TRUCK_PHONE_MAP);
  if (!raw && process.env.WHATSAPP_TRUCK_PHONE_MAP_BASE64) {
    try { raw = Buffer.from(process.env.WHATSAPP_TRUCK_PHONE_MAP_BASE64, "base64").toString("utf8"); } catch { raw = ""; }
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([phone, truck]) => {
      const normalized = normalizePhone(phone);
      const label = normalizeTruck(truck);
      return normalized && label ? [[normalized, label]] : [];
    }));
  } catch {
    return {};
  }
}

function appointmentJkNumber(appointment: AnyRecord): string {
  return normalizeJkNumber(appointment.jk_number || appointment.job_id || appointment.job_number || appointment.jkNumber);
}

function appointmentId(appointment: AnyRecord): string {
  return clean(appointment.appt_id || appointment.appointment_id || appointment.appointmentId);
}

function appointmentTruck(appointment: AnyRecord): string {
  return normalizeTruck(appointment.truck || appointment.assigned_truck || appointment.truck_number);
}

function findScheduledJob(jkNumber: string, receivedAt: string): { appointmentId: string; date: string; truck: string; status: string } | null {
  const received = new Date(receivedAt);
  if (!Number.isFinite(received.getTime())) return null;
  const messageDate = chicagoDateKey(received);
  for (const date of [messageDate, addDays(messageDate, -1)]) {
    const metrics = readMetrics(date);
    const appointments = Array.isArray(metrics?.appointments) ? metrics.appointments as AnyRecord[] : [];
    const matches = appointments.filter((appointment) => appointmentJkNumber(appointment) === jkNumber);
    if (matches.length !== 1) continue;
    const matched = matches[0];
    const id = appointmentId(matched);
    if (!/^\d{1,12}$/.test(id)) return null;
    return {
      appointmentId: id,
      date,
      truck: appointmentTruck(matched),
      status: clean(matched.job_status || matched.status || matched.final_status),
    };
  }
  return null;
}

function activeSession(senderPhone: string, receivedAt: string): CloseoutSession | null {
  try {
    const payload = JSON.parse(fs.readFileSync(senderFile("sessions", senderPhone), "utf8")) as CloseoutSession;
    const updatedAt = new Date(payload.updatedAt).getTime();
    const messageAt = new Date(receivedAt).getTime();
    if (!Number.isFinite(updatedAt) || !Number.isFinite(messageAt) || messageAt < updatedAt - 60_000 || messageAt - updatedAt > SESSION_MAX_IDLE_MS) return null;
    return payload.version === 1 && Array.isArray(payload.textBlocks) && Array.isArray(payload.messageIds) ? payload : null;
  } catch {
    return null;
  }
}

function closeSession(senderPhone: string): void {
  try { fs.unlinkSync(senderFile("sessions", senderPhone)); } catch { /* no active session */ }
}

function parseClock(value: string): string | null {
  const normalized = clean(value).toUpperCase().replace(/\./g, "");
  const twelveHour = normalized.match(/^(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([AP]M)$/);
  if (twelveHour) return `${Number(twelveHour[1])}:${twelveHour[2] || "00"} ${twelveHour[3]}`;
  const twentyFourHour = normalized.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!twentyFourHour) return null;
  const hour = Number(twentyFourHour[1]);
  return `${hour % 12 || 12}:${twentyFourHour[2]} ${hour >= 12 ? "PM" : "AM"}`;
}

function parseTimes(text: string): { startTime: string; endTime: string } | null {
  const labelledStart = text.match(/\b(?:start|started)(?:\s+time)?\s*(?:at|:)?\s*((?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap]m|(?:[01]?\d|2[0-3]):[0-5]\d)/i)?.[1];
  const labelledEnd = text.match(/\b(?:end|ended|finish|finished)(?:\s+time)?\s*(?:at|:)?\s*((?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap]m|(?:[01]?\d|2[0-3]):[0-5]\d)/i)?.[1];
  if (labelledStart && labelledEnd) {
    const startTime = parseClock(labelledStart);
    const endTime = parseClock(labelledEnd);
    return startTime && endTime ? { startTime, endTime } : null;
  }
  const range = text.match(/\b((?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap]m|(?:[01]?\d|2[0-3]):[0-5]\d)\s*(?:-|to|until)\s*((?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap]m|(?:[01]?\d|2[0-3]):[0-5]\d)\b/i);
  if (!range) return null;
  const startTime = parseClock(range[1]);
  const endTime = parseClock(range[2]);
  return startTime && endTime ? { startTime, endTime } : null;
}

function parseCategory(text: string): string {
  const normalized = normalizedWords(text);
  return JOB_CATEGORIES.find((category) => normalized.includes(normalizedWords(category))) || "";
}

function matchingCharge(line: string): JobCloseoutChargeDefinition | null {
  const normalized = ` ${normalizedWords(line)} `;
  const matches = JOB_CLOSEOUT_CHARGES.filter((charge) => charge.aliases.some((alias) => normalized.includes(` ${normalizedWords(alias)} `)));
  if (!matches.length) return null;
  return matches.sort((left, right) => Math.max(...right.aliases.map((alias) => alias.length)) - Math.max(...left.aliases.map((alias) => alias.length)))[0];
}

function parseQuantity(line: string, charge: JobCloseoutChargeDefinition): number {
  const normalized = normalizedWords(line);
  const alias = charge.aliases.map(normalizedWords).sort((left, right) => right.length - left.length).find((candidate) => normalized.includes(candidate));
  if (!alias) return 1;
  const aliasIndex = normalized.indexOf(alias);
  const prefix = normalized.slice(0, aliasIndex).trim();
  const suffix = normalized.slice(aliasIndex + alias.length).trim();
  const match = prefix.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:x\s*)?$/)
    || suffix.match(/^(\d+(?:\.\d+)?)\s*(?:x\s*)?/);
  const quantity = Number(match?.[1] || 1);
  return Number.isFinite(quantity) && quantity > 0 && quantity <= 100 ? quantity : 1;
}

function parseOtherCharges(lines: string[]): { charges: EnteredCharge[]; ambiguous: string[] } {
  const charges: EnteredCharge[] = [];
  const ambiguous: string[] = [];
  for (const line of lines) {
    if (/^category\b/i.test(line)) continue;
    if (/^\s*(?:items?|cc\s*fee|credit\s*card\s*(?:fee|surcharge))\s*:\s*(?:none|no|n\/a)\s*$/i.test(line)) continue;
    const definition = matchingCharge(line);
    if (!definition) continue;
    if (charges.some((charge) => charge.key === definition.key)) {
      ambiguous.push(`${definition.label} was listed more than once`);
      continue;
    }
    if (definition.percentage) {
      charges.push({ key: definition.key, label: definition.label, quantity: 1, unitPrice: null, total: null, percentage: definition.percentage });
      continue;
    }
    const quantity = parseQuantity(line, definition);
    const unitPrice = parseAmount(line);
    const hasUnitMarker = /(?:@|\beach\b|\bper\b)/i.test(line);
    if (unitPrice === null) {
      ambiguous.push(`${definition.label} needs its actual unit price`);
      continue;
    }
    if (quantity > 1 && !hasUnitMarker) {
      ambiguous.push(`${definition.label} needs @ or 'each' to confirm ${formatMoney(unitPrice)} is the unit price`);
      continue;
    }
    charges.push({ key: definition.key, label: definition.label, quantity, unitPrice, total: money(quantity * unitPrice), percentage: null });
  }
  return { charges, ambiguous };
}

function parseLoad(lines: string[], kind: "load" | "bedload"): { quantity: number; size: string; price: number } | null {
  const line = lines.find((candidate) => kind === "bedload" ? /\bbed\s*load\b/i.test(candidate) : /\b(?:truck\s+)?load\b/i.test(candidate) && !/\bbed\s*load\b/i.test(candidate));
  if (!line) return null;
  const price = parseAmount(line);
  if (price === null) return null;
  const quantityMatch = normalizedWords(line).match(/(?:load|bedload|bed load)\s+(\d+(?:\.\d+)?)\s*(?:x\s*)?/i);
  const quantity = Number(quantityMatch?.[1] || 1);
  const size = line.match(/\b(?:1\/12|1\/6|1\/4|1\/3|3\/8|1\/2|5\/8|2\/3|3\/4|5\/6|7\/8|minimum|bags?)\b/i)?.[0] || "";
  return Number.isFinite(quantity) && quantity > 0 && quantity <= 100 ? { quantity, size, price } : null;
}

function parsePayments(lines: string[]): EnteredPayment[] {
  return lines.flatMap((line) => {
    const method: EnteredPayment["method"] | null = /\b(?:credit\s*card|visa|mastercard|amex|discover)\b/i.test(line)
      ? "Credit Card"
      : /\bcheck\b/i.test(line)
        ? "Check"
        : /\bcash\b/i.test(line)
          ? "Cash"
          : /\b(?:bill|billed)\b/i.test(line)
            ? "Billed"
            : null;
    const amount = parseAmount(line);
    if (!method || amount === null || /\b(?:tip|discount|fee|surcharge)\b/i.test(line)) return [];
    const checkNumber = method === "Check" ? line.match(/\b(?:check\s*)?(?:#|number|no\.?)[\s:#-]*([a-z0-9-]{1,30})\b/i)?.[1] || null : null;
    const cardLastFour = method === "Credit Card" ? line.match(/\b(?:last\s*4|last\s*four|ending(?:\s+in)?)[\s:#-]*(\d{4})\b/i)?.[1] || null : null;
    return [{ method, amount, checkNumber, cardLastFour }];
  });
}

function compilePlan(session: CloseoutSession, senderPhone: string): { plan: JobCloseoutPlan | null; missing: string[]; ambiguous: string[] } {
  const text = session.textBlocks.join("\n");
  const lines = text.split(/\r?\n|;/).map(clean).filter(Boolean);
  const load = parseLoad(lines, "load");
  const bedload = parseLoad(lines, "bedload");
  const { charges, ambiguous } = parseOtherCharges(lines);
  const discount = parseAmount(lines.find((line) => /\bdiscount\b/i.test(line)) || "") || 0;
  const tip = parseAmount(lines.find((line) => /\btip\b/i.test(line)) || "") || 0;
  const category = parseCategory(text);
  const times = parseTimes(text);
  const payments = parsePayments(lines);
  const ccCharge = charges.find((charge) => charge.percentage);
  const hasCardPayment = payments.some((payment) => payment.method === "Credit Card");
  if (hasCardPayment && !ccCharge) ambiguous.push("Credit Card payment requires the CC Surcharge (Card Present), 3.00% line");
  if (!hasCardPayment && ccCharge) ambiguous.push("CC Surcharge (Card Present) requires a Credit Card payment");
  const missing = [
    ...(!load && !bedload && !charges.some((charge) => charge.total !== null) ? ["at least one priced item"] : []),
    ...(!times ? ["start and finish times"] : []),
    ...(!payments.length ? ["payment method and amount"] : []),
  ];
  if (missing.length || ambiguous.length || !times) return { plan: null, missing, ambiguous };
  const chargesSubtotal = money((load?.price || 0) + (bedload?.price || 0) + charges.reduce((sum, charge) => sum + (charge.total || 0), 0) - discount);
  const creditCardFee = money(chargesSubtotal * ((ccCharge?.percentage || 0) / 100));
  const jobTotal = money(chargesSubtotal + creditCardFee);
  const paymentTotal = money(payments.reduce((sum, payment) => sum + payment.amount, 0));
  const paymentReconciles = Math.abs(paymentTotal - jobTotal) < 0.01 || Math.abs(paymentTotal - money(jobTotal + tip)) < 0.01;
  if (!paymentReconciles) {
    ambiguous.push(`Payments total ${formatMoney(paymentTotal)} but charges total ${formatMoney(jobTotal)}${tip ? ` (${formatMoney(jobTotal + tip)} including tip)` : ""}`);
    return { plan: null, missing, ambiguous };
  }
  return {
    plan: {
      version: 1,
      jkNumber: session.jkNumber,
      appointmentId: session.appointmentId,
      date: session.date,
      truck: session.truck,
      load,
      bedload,
      charges,
      discount,
      tip,
      category,
      startTime: times.startTime,
      endTime: times.endTime,
      payments,
      chargesSubtotal,
      creditCardFee,
      jobTotal,
      paymentTotal,
      paymentReconciles,
      sourceMessageIds: session.messageIds,
      senderHash: recordKey(normalizePhone(senderPhone)),
      // Confirmation validity is based on the inbound-message timeline. Using
      // processing time can reject a valid confirmation when queue recovery
      // processes the original closeout after the confirmation arrived.
      createdAt: session.updatedAt,
      mode: "shadow",
    },
    missing,
    ambiguous,
  };
}

export function formatJobCloseoutPreview(plan: JobCloseoutPlan): string {
  const chargeLines = [
    ...(plan.load ? [`Truck load: ${plan.load.quantity}${plan.load.size ? ` × ${plan.load.size}` : ""} — ${formatMoney(plan.load.price)}`] : []),
    ...(plan.bedload ? [`Bedload: ${plan.bedload.quantity}${plan.bedload.size ? ` × ${plan.bedload.size}` : ""} — ${formatMoney(plan.bedload.price)}`] : []),
    ...plan.charges.map((charge) => charge.percentage
      ? `${charge.label}: ${charge.percentage.toFixed(2)}% — ${formatMoney(plan.creditCardFee)}`
      : `${charge.label}: ${charge.quantity} × ${formatMoney(charge.unitPrice || 0)} = ${formatMoney(charge.total || 0)}`),
    ...(plan.discount ? [`Discount: -${formatMoney(plan.discount)}`] : []),
  ];
  const paymentLines = plan.payments.map((payment) => `${payment.method}: ${formatMoney(payment.amount)}${payment.checkNumber ? ` · check #${payment.checkNumber}` : ""}${payment.cardLastFour ? ` · ending ${payment.cardLastFour}` : ""}`);
  return [
    `SHADOW CLOSEOUT — ${plan.jkNumber} · ${plan.truck}`,
    ...chargeLines,
    `Job total: ${formatMoney(plan.jobTotal)}`,
    ...(plan.tip ? [`Tip: ${formatMoney(plan.tip)}`] : []),
    ...paymentLines,
    ...(plan.category ? [`Category: ${plan.category}`] : []),
    `Time: ${plan.startTime}–${plan.endTime}`,
    "",
    `Reply CONFIRM ${plan.jkNumber} to test the final confirmation. Shadow mode cannot change JunkWare.`,
  ].join("\n");
}

function mark(message: WhatsAppTextMessage, outcome: string, detail: Record<string, unknown> = {}): void {
  writeJsonAtomic(messageFile(message.messageId), { version: 1, messageId: message.messageId, outcome, processedAt: new Date().toISOString(), ...detail });
}

function review(message: WhatsAppTextMessage, reason: string, reply: string, detail: Record<string, unknown> = {}): JobCloseoutIngestResult {
  enqueueOpsBotReply(message, reply, "job-closeout-review");
  writeJsonAtomic(path.join(directory("review"), `${recordKey(message.messageId)}.json`), {
    version: 1,
    messageId: message.messageId,
    reportedAt: message.receivedAt,
    senderHash: recordKey(normalizePhone(message.senderPhone)),
    reason,
    ...detail,
  });
  mark(message, "review", { reason });
  return { status: "review" };
}

export function ingestJobCloseoutText(message: WhatsAppTextMessage): JobCloseoutIngestResult {
  ensureDirectories();
  const marker = messageFile(message.messageId);
  if (fs.existsSync(marker)) return { status: "duplicate" };

  const confirmJk = confirmationJk(message.text);
  if (confirmJk) {
    let plan: JobCloseoutPlan | null = null;
    try { plan = JSON.parse(fs.readFileSync(senderFile("pending", message.senderPhone), "utf8")) as JobCloseoutPlan; } catch { plan = null; }
    if (!plan || plan.jkNumber !== confirmJk) return review(message, "confirmation_without_matching_preview", `No matching shadow preview is waiting for ${confirmJk}. Send Close ${confirmJk} and the closeout details first.`);
    const age = new Date(message.receivedAt).getTime() - new Date(plan.createdAt).getTime();
    if (!Number.isFinite(age) || age < -60_000 || age > SESSION_MAX_IDLE_MS) return review(message, "confirmation_expired", `The ${confirmJk} preview expired. Send the closeout details again.`);
    writeJsonAtomic(path.join(directory("shadow-confirmed"), `${recordKey(message.messageId)}.json`), { ...plan, confirmationMessageId: message.messageId, confirmedAt: message.receivedAt });
    enqueueOpsBotReply(message, `Shadow confirmation passed for ${confirmJk}. No JunkWare changes were made.`, "job-closeout-shadow-confirmed");
    mark(message, "shadow_confirmed", { jkNumber: confirmJk });
    closeSession(message.senderPhone);
    try { fs.unlinkSync(senderFile("pending", message.senderPhone)); } catch { /* already absent */ }
    return { status: "shadow_confirmed", plan };
  }

  if (cancelIntent(message.text)) {
    const session = activeSession(message.senderPhone, message.receivedAt);
    if (!session) return { status: "ignored" };
    closeSession(message.senderPhone);
    try { fs.unlinkSync(senderFile("pending", message.senderPhone)); } catch { /* no pending preview */ }
    enqueueOpsBotReply(message, `Canceled the ${session.jkNumber} closeout draft. No JunkWare changes were made.`, "job-closeout-canceled");
    mark(message, "canceled", { jkNumber: session.jkNumber });
    return { status: "canceled" };
  }

  const session = activeSession(message.senderPhone, message.receivedAt);
  if (session && /^(?:fuel|gas|dump)(?:\s+(?:run|fill-?up|expense))?$/i.test(clean(message.text))) {
    closeSession(message.senderPhone);
    try { fs.unlinkSync(senderFile("pending", message.senderPhone)); } catch { /* no pending preview */ }
    return { status: "ignored" };
  }
  const intent = closeoutIntent(message.text);
  if (!intent && !session) return { status: "ignored" };

  const explicitJk = extractJkNumber(message.text);
  if (intent && !explicitJk) {
    writeJsonAtomic(senderFile("sessions", message.senderPhone), {
      version: 1,
      jkNumber: "",
      appointmentId: "",
      date: "",
      truck: "",
      openedAt: message.receivedAt,
      updatedAt: message.receivedAt,
      textBlocks: [],
      messageIds: [message.messageId],
    } satisfies CloseoutSession);
    enqueueOpsBotReply(message, jobCloseoutTemplate(), "job-closeout-prompt");
    mark(message, "prompted");
    return { status: "prompted" };
  }

  let current = session;
  if (explicitJk && (!session || session.jkNumber !== explicitJk)) {
    const job = findScheduledJob(explicitJk, message.receivedAt);
    if (!job) return review(message, "job_not_on_schedule", `${explicitJk} was not found exactly once on today’s or yesterday’s JunkWare schedule.`);
    if (/complete|closed|cancel/i.test(job.status)) return review(message, "job_not_closeable", `${explicitJk} is already ${job.status || "not closeable"}. No changes were made.`);
    const senderTruck = truckPhoneMap()[normalizePhone(message.senderPhone)] || "";
    if (!senderTruck) return review(message, "sender_not_mapped", "This phone is not mapped to a truck, so OpsBot cannot start a job closeout.");
    if (!job.truck || normalizeTruck(senderTruck) !== normalizeTruck(job.truck)) {
      return review(message, "truck_mismatch", `${explicitJk} is assigned to ${job.truck || "an unknown truck"}, not ${senderTruck}. No changes were made.`);
    }
    current = {
      version: 1,
      jkNumber: explicitJk,
      appointmentId: job.appointmentId,
      date: job.date,
      truck: job.truck,
      openedAt: message.receivedAt,
      updatedAt: message.receivedAt,
      textBlocks: [],
      messageIds: [],
    };
  }
  if (!current) return { status: "ignored" };

  const updated: CloseoutSession = {
    ...current,
    updatedAt: message.receivedAt,
    textBlocks: [...current.textBlocks, message.text],
    messageIds: [...new Set([...current.messageIds, message.messageId])],
  };
  writeJsonAtomic(senderFile("sessions", message.senderPhone), updated);
  const compiled = compilePlan(updated, message.senderPhone);
  if (!compiled.plan) {
    const missing = [...compiled.missing, ...compiled.ambiguous];
    if (updated.textBlocks.length === 1 && clean(message.text).replace(/\b(?:close|closeout|out)\b/gi, "").replace(/JK\s*[-#:]*\s*\d{4,12}/i, "").trim() === "") {
      enqueueOpsBotReply(message, `${updated.jkNumber} is matched to ${updated.truck}.\n\n${jobCloseoutTemplate()}`, "job-closeout-collecting");
    } else {
      enqueueOpsBotReply(message, `Closeout draft saved for ${updated.jkNumber}. Still needed:\n- ${missing.join("\n- ")}\n\nSend the missing details or type Cancel closeout.`, "job-closeout-collecting");
    }
    mark(message, "collecting", { jkNumber: updated.jkNumber, missing });
    return { status: "collecting", missing };
  }

  writeJsonAtomic(senderFile("pending", message.senderPhone), compiled.plan);
  enqueueOpsBotReply(message, formatJobCloseoutPreview(compiled.plan), "job-closeout-preview");
  mark(message, "preview", { jkNumber: compiled.plan.jkNumber });
  return { status: "preview", plan: compiled.plan };
}
