import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizePhone } from "@/lib/whatsapp-job-photo-matching";
import { whatsappPhotoStateDirectory } from "@/lib/whatsapp-job-photo-queue";

type ReceiptPhoto = {
  messageId: string;
  status: "pending" | "completed";
  completedAt?: string;
};

export type WhatsAppPhotoReceiptBatch = {
  version: 1;
  batchId: string;
  recipient: string;
  phoneNumberId: string;
  jkNumber: string;
  jobDate: string;
  openedAt: string;
  updatedAt: string;
  photos: ReceiptPhoto[];
  attempts?: number;
  lastAttemptAt?: string;
  lastError?: string;
  nextAttemptAt?: string;
};

export type WhatsAppPhotoReceiptDeliveryResult = {
  pending: number;
  attempted: number;
  delivered: number;
  failed: number;
};

const DEFAULT_BATCH_QUIET_SECONDS = 60;

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function recordKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function directory(name: "pending" | "delivered"): string {
  return path.join(whatsappPhotoStateDirectory(), "receipt-notifications", name);
}

function ensureDirectories(): void {
  for (const name of ["pending", "delivered"] as const) {
    fs.mkdirSync(directory(name), { recursive: true, mode: 0o700 });
  }
}

function writeJsonAtomic(target: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function jsonFiles(name: "pending" | "delivered"): string[] {
  try {
    return fs.readdirSync(directory(name))
      .filter((file) => /^[a-f0-9]{64}\.json$/.test(file))
      .sort()
      .map((file) => path.join(directory(name), file));
  } catch {
    return [];
  }
}

function readBatch(file: string): WhatsAppPhotoReceiptBatch | null {
  try {
    const batch = JSON.parse(fs.readFileSync(file, "utf8")) as WhatsAppPhotoReceiptBatch;
    return batch?.version === 1 && Array.isArray(batch.photos) ? batch : null;
  } catch {
    return null;
  }
}

function pendingBatchFile(jobDate: string, jkNumber: string, recipient: string): string {
  return path.join(directory("pending"), `${recordKey(`${jobDate}:${jkNumber}:${recipient}`)}.json`);
}

function deliveredBatchFile(batchId: string): string {
  return path.join(directory("delivered"), `${recordKey(batchId)}.json`);
}

function quietWindowMs(): number {
  const value = Number(process.env.WHATSAPP_PHOTO_RECEIPT_BATCH_QUIET_SECONDS);
  const seconds = Number.isFinite(value) && value >= 0 ? value : DEFAULT_BATCH_QUIET_SECONDS;
  return seconds * 1_000;
}

function formatReceipt(batch: WhatsAppPhotoReceiptBatch): string {
  const count = batch.photos.length;
  return `Recorded ${count} ${count === 1 ? "photo" : "photos"} for ${batch.jkNumber}.`;
}

export function recordWhatsAppPhotoReceipt(input: {
  messageId: string;
  senderPhone: string;
  phoneNumberId: string;
  jkNumber: string;
  jobDate: string;
  status: "pending" | "completed";
  now?: Date;
}): { duplicate: boolean } {
  ensureDirectories();
  const messageId = clean(input.messageId);
  const recipient = normalizePhone(input.senderPhone);
  const phoneNumberId = clean(input.phoneNumberId);
  const jkNumber = clean(input.jkNumber).toUpperCase();
  const jobDate = clean(input.jobDate);
  if (!messageId || !recipient || !/^\d+$/.test(phoneNumberId) || !/^JK\d{4,12}$/.test(jkNumber) || !/^\d{4}-\d{2}-\d{2}$/.test(jobDate)) {
    throw new Error("The WhatsApp photo receipt is missing valid message, recipient, phone number, JK number, or date data.");
  }

  const now = input.now || new Date();
  const nowIso = now.toISOString();
  const file = pendingBatchFile(jobDate, jkNumber, recipient);
  const existing = readBatch(file);
  const batch: WhatsAppPhotoReceiptBatch = existing || {
    version: 1,
    batchId: `${jobDate}:${jkNumber}:${recipient}:${messageId}`,
    recipient,
    phoneNumberId,
    jkNumber,
    jobDate,
    openedAt: nowIso,
    updatedAt: nowIso,
    photos: [],
  };
  const index = batch.photos.findIndex((photo) => photo.messageId === messageId);
  const current = index >= 0 ? batch.photos[index] : null;
  const status = input.status === "completed" || current?.status === "completed" ? "completed" : "pending";
  const photo: ReceiptPhoto = {
    messageId,
    status,
    ...(status === "completed" ? { completedAt: current?.completedAt || nowIso } : {}),
  };
  if (index >= 0) batch.photos[index] = photo;
  else batch.photos.push(photo);
  batch.updatedAt = nowIso;
  delete batch.nextAttemptAt;
  writeJsonAtomic(file, batch);
  return { duplicate: Boolean(current && current.status === status) };
}

export async function deliverWhatsAppPhotoReceipts(
  send: (receipt: { recipient: string; phoneNumberId: string; text: string }) => Promise<unknown>,
  options?: { now?: Date; limit?: number },
): Promise<WhatsAppPhotoReceiptDeliveryResult> {
  ensureDirectories();
  const result: WhatsAppPhotoReceiptDeliveryResult = {
    pending: jsonFiles("pending").length,
    attempted: 0,
    delivered: 0,
    failed: 0,
  };
  const now = options?.now || new Date();
  for (const file of jsonFiles("pending").slice(0, Math.max(0, options?.limit ?? 10))) {
    const batch = readBatch(file);
    if (!batch || !batch.photos.length || batch.photos.some((photo) => photo.status !== "completed")) continue;
    const updatedAt = new Date(batch.updatedAt).getTime();
    if (!Number.isFinite(updatedAt) || now.getTime() - updatedAt < quietWindowMs()) continue;
    const nextAttemptAt = new Date(clean(batch.nextAttemptAt)).getTime();
    if (Number.isFinite(nextAttemptAt) && nextAttemptAt > now.getTime()) continue;

    result.attempted += 1;
    try {
      await send({ recipient: batch.recipient, phoneNumberId: batch.phoneNumberId, text: formatReceipt(batch) });
      writeJsonAtomic(deliveredBatchFile(batch.batchId), { ...batch, deliveredAt: now.toISOString() });
      fs.unlinkSync(file);
      result.delivered += 1;
      result.pending -= 1;
    } catch (error) {
      const attempts = Math.max(0, Number(batch.attempts) || 0) + 1;
      writeJsonAtomic(file, {
        ...batch,
        attempts,
        lastAttemptAt: now.toISOString(),
        lastError: clean(error instanceof Error ? error.message : error).slice(0, 200),
        nextAttemptAt: new Date(now.getTime() + Math.min(900, 30 * (2 ** Math.min(5, attempts - 1))) * 1_000).toISOString(),
      });
      result.failed += 1;
    }
  }
  return result;
}
