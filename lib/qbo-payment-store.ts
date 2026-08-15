import fs from "node:fs";
import path from "node:path";

export type QboPaymentAuditStatus = "requested" | "succeeded" | "failed" | "unknown";

export type QboPaymentAuditRecord = {
  version: 1;
  requestId: string;
  appointmentId: string;
  jkNumber: string;
  actor: string;
  amount: string;
  currency: "USD";
  environment: "sandbox" | "production";
  status: QboPaymentAuditStatus;
  chargeId: string;
  chargeStatus: string;
  cardLastFour: string;
  intuitTid: string;
  error: string;
  createdAt: string;
  updatedAt: string;
};

function defaultDataRoot(): string {
  return process.env.OPSBOT_DATA_DIR
    || path.join(process.env.HOME || process.cwd(), ".openclaw", "workspace", "opsbot", "data");
}

export function qboPaymentAuditDirectory(): string {
  return String(
    process.env.QBO_PAYMENTS_AUDIT_DIR
      || path.join(defaultDataRoot(), "integrations", "qbo-payments"),
  ).trim();
}

function requestDirectory(): string {
  return path.join(qboPaymentAuditDirectory(), "requests");
}

function lockDirectory(): string {
  return path.join(qboPaymentAuditDirectory(), "locks");
}

function safeRequestId(requestId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error("The payment request ID is not valid.");
  return requestId.toLowerCase();
}

function prepareDirectories(): void {
  fs.mkdirSync(requestDirectory(), { recursive: true, mode: 0o700 });
  fs.mkdirSync(lockDirectory(), { recursive: true, mode: 0o700 });
  fs.chmodSync(qboPaymentAuditDirectory(), 0o700);
  fs.chmodSync(requestDirectory(), 0o700);
  fs.chmodSync(lockDirectory(), 0o700);
}

function requestFile(requestId: string): string {
  return path.join(requestDirectory(), `${safeRequestId(requestId)}.json`);
}

export function readQboPaymentAuditRecord(requestId: string): QboPaymentAuditRecord | null {
  const file = requestFile(requestId);
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<QboPaymentAuditRecord>;
  if (parsed.version !== 1 || parsed.requestId !== safeRequestId(requestId)) {
    throw new Error("The payment audit record is not valid.");
  }
  return parsed as QboPaymentAuditRecord;
}

export function writeQboPaymentAuditRecord(record: QboPaymentAuditRecord): void {
  prepareDirectories();
  const normalized = { ...record, requestId: safeRequestId(record.requestId) };
  const file = requestFile(record.requestId);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);

  const auditFile = path.join(qboPaymentAuditDirectory(), "audit.jsonl");
  fs.appendFileSync(auditFile, `${JSON.stringify(normalized)}\n`, { mode: 0o600 });
  fs.chmodSync(auditFile, 0o600);
}

export class QboPaymentRequestBusyError extends Error {}

export async function withQboPaymentRequestLock<T>(requestId: string, callback: () => Promise<T>): Promise<T> {
  prepareDirectories();
  const lock = path.join(lockDirectory(), `${safeRequestId(requestId)}.lock`);
  if (fs.existsSync(lock)) {
    const age = Date.now() - fs.statSync(lock).mtimeMs;
    if (age > 5 * 60_000) fs.unlinkSync(lock);
  }

  let descriptor: number;
  try {
    descriptor = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new QboPaymentRequestBusyError("This payment request is already being processed.");
    }
    throw error;
  }

  try {
    fs.writeFileSync(descriptor, `${process.pid}\n`);
    return await callback();
  } finally {
    fs.closeSync(descriptor);
    if (fs.existsSync(lock)) fs.unlinkSync(lock);
  }
}
