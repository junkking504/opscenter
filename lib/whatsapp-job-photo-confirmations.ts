import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { enqueueOpsBotReply } from "@/lib/whatsapp-crew-expenses";
import { normalizePhone } from "@/lib/whatsapp-job-photo-matching";
import { whatsappPhotoStateDirectory } from "@/lib/whatsapp-job-photo-queue";

type BatchPhoto = {
  messageId: string;
  receivedAt: string;
  completedAt: string;
};

type PhotoConfirmationBatch = {
  version: 1;
  batchId: string;
  jkNumber: string;
  jobDate: string;
  senderPhone: string;
  phoneNumberId: string;
  openedAt: string;
  updatedAt: string;
  photos: BatchPhoto[];
  confirmationQueuedAt?: string;
};

const DEFAULT_BATCH_QUIET_SECONDS = 60;

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function recordKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function batchDirectory(name: "pending" | "delivered"): string {
  return path.join(whatsappPhotoStateDirectory(), "whatsapp-confirmations", name);
}

function pendingBatchFile(jobDate: string, jkNumber: string, senderPhone: string): string {
  return path.join(batchDirectory("pending"), `${recordKey(`${jobDate}:${jkNumber}:${senderPhone}`)}.json`);
}

function deliveredBatchFile(batchId: string): string {
  return path.join(batchDirectory("delivered"), `${recordKey(batchId)}.json`);
}

function ensureDirectories(): void {
  for (const name of ["pending", "delivered"] as const) {
    fs.mkdirSync(batchDirectory(name), { recursive: true, mode: 0o700 });
  }
}

function writeJsonAtomic(target: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function readBatch(file: string): PhotoConfirmationBatch | null {
  try {
    const batch = JSON.parse(fs.readFileSync(file, "utf8")) as PhotoConfirmationBatch;
    return batch?.version === 1 && Array.isArray(batch.photos) ? batch : null;
  } catch {
    return null;
  }
}

function pendingFiles(): string[] {
  try {
    return fs.readdirSync(batchDirectory("pending"))
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .sort()
      .map((name) => path.join(batchDirectory("pending"), name));
  } catch {
    return [];
  }
}

export function recordVerifiedWhatsAppJobPhoto(input: {
  messageId: string;
  jkNumber: string;
  jobDate: string;
  senderPhone: string;
  phoneNumberId: string;
  receivedAt: string;
  now?: Date;
}): { duplicate: boolean } {
  ensureDirectories();
  const messageId = clean(input.messageId);
  const jkNumber = clean(input.jkNumber).toUpperCase();
  const jobDate = clean(input.jobDate);
  const senderPhone = normalizePhone(input.senderPhone);
  if (!messageId || !/^JK\d{4,12}$/.test(jkNumber) || !/^\d{4}-\d{2}-\d{2}$/.test(jobDate) || !senderPhone) {
    throw new Error("The WhatsApp photo confirmation record is missing a valid message, job, date, or sender.");
  }
  const nowIso = (input.now || new Date()).toISOString();
  const file = pendingBatchFile(jobDate, jkNumber, senderPhone);
  const existing = readBatch(file);
  const batch: PhotoConfirmationBatch = existing || {
    version: 1,
    batchId: `${jobDate}:${jkNumber}:${senderPhone}:${messageId}`,
    jkNumber,
    jobDate,
    senderPhone,
    phoneNumberId: clean(input.phoneNumberId),
    openedAt: nowIso,
    updatedAt: nowIso,
    photos: [],
  };
  if (batch.photos.some((photo) => photo.messageId === messageId)) return { duplicate: true };
  batch.photos.push({ messageId, receivedAt: clean(input.receivedAt), completedAt: nowIso });
  batch.updatedAt = nowIso;
  writeJsonAtomic(file, batch);
  return { duplicate: false };
}

export function queueVerifiedWhatsAppJobPhotoBatchConfirmations(
  now = new Date(),
  options: { hasUnfinishedPhotos?: boolean } = {},
): { pending: number; queued: number } {
  ensureDirectories();
  const quietMs = numberEnv("WHATSAPP_JOB_PHOTO_BATCH_QUIET_SECONDS", DEFAULT_BATCH_QUIET_SECONDS) * 1_000;
  let pending = 0;
  let queued = 0;
  for (const file of pendingFiles()) {
    const batch = readBatch(file);
    if (!batch || !batch.photos.length) continue;
    pending += 1;
    if (options.hasUnfinishedPhotos) continue;
    const receivedTimes = batch.photos
      .map((photo) => new Date(photo.receivedAt).getTime())
      .filter(Number.isFinite);
    const latestReceivedAt = receivedTimes.length ? Math.max(...receivedTimes) : Number.NaN;
    const quietReferenceAt = Number.isFinite(latestReceivedAt)
      ? latestReceivedAt
      : new Date(batch.updatedAt).getTime();
    if (batch.confirmationQueuedAt || !Number.isFinite(quietReferenceAt) || now.getTime() - quietReferenceAt < quietMs) continue;
    const firstPhoto = batch.photos[0];
    const count = batch.photos.length;
    enqueueOpsBotReply({
      messageId: firstPhoto.messageId,
      senderPhone: batch.senderPhone,
      phoneNumberId: batch.phoneNumberId,
    }, `${count} ${count === 1 ? "photo" : "photos"} for ${batch.jkNumber} uploaded and verified in JunkWare.`, "job-photo-batch-confirmed");
    batch.confirmationQueuedAt = now.toISOString();
    batch.updatedAt = now.toISOString();
    writeJsonAtomic(deliveredBatchFile(batch.batchId), batch);
    fs.unlinkSync(file);
    queued += 1;
  }
  return { pending, queued };
}
