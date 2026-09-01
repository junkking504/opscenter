import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PAYMENT_EXCEPTION_REVIEW_DISPOSITIONS = [
  "keep_open",
  "qbo_follow_up",
  "junkware_follow_up",
  "refund_verification",
  "no_issue_confirmed",
] as const;

export type PaymentExceptionReviewDisposition = (typeof PAYMENT_EXCEPTION_REVIEW_DISPOSITIONS)[number];

export type PaymentExceptionReviewRecord = {
  recordId: string;
  exceptionId: string;
  date: string;
  exceptionType: string;
  reference: string;
  disposition: PaymentExceptionReviewDisposition;
  owner: string;
  nextAction: string;
  note: string;
  sourceObservationKey: string;
  sourceGeneratedAt: string;
  sourceMerchantCollectedAt: string;
  sourceStatus: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type PaymentExceptionReviewAuditEvent = {
  eventId: string;
  recordId: string;
  action: "payment_exception_review_recorded";
  occurredAt: string;
  actor: string;
  before: PaymentExceptionReviewRecord | null;
  after: PaymentExceptionReviewRecord;
};

export type PaymentExceptionReviewStore = {
  version: 1;
  updatedAt: string;
  records: PaymentExceptionReviewRecord[];
  audit: PaymentExceptionReviewAuditEvent[];
};

export type SavePaymentExceptionReviewInput = Omit<
  PaymentExceptionReviewRecord,
  "recordId" | "createdAt" | "updatedAt"
>;

function dataRoot(): string {
  const configured = String(process.env.OPSBOT_DATA_DIR || "").trim();
  return configured || path.join(process.cwd(), "data");
}

export function paymentExceptionReviewStorePath(): string {
  const configured = String(process.env.PAYMENT_EXCEPTION_REVIEW_FILE || "").trim();
  return configured || path.join(dataRoot(), "finance", "payment_exception_reviews.json");
}

function validExceptionId(value: unknown): string {
  const id = String(value || "").trim();
  return /^payment_exception_[0-9a-f]{24}$/.test(id) ? id : "";
}

function parseRecord(value: unknown): PaymentExceptionReviewRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const exceptionId = validExceptionId(row.exceptionId);
  const disposition = String(row.disposition || "") as PaymentExceptionReviewDisposition;
  if (!exceptionId || !PAYMENT_EXCEPTION_REVIEW_DISPOSITIONS.includes(disposition)) return null;
  return {
    recordId: String(row.recordId || randomUUID()),
    exceptionId,
    date: String(row.date || "").trim(),
    exceptionType: String(row.exceptionType || "").trim(),
    reference: String(row.reference || "").trim(),
    disposition,
    owner: String(row.owner || "").trim(),
    nextAction: String(row.nextAction || "").trim(),
    note: String(row.note || "").trim(),
    sourceObservationKey: String(row.sourceObservationKey || "").trim(),
    sourceGeneratedAt: String(row.sourceGeneratedAt || "").trim(),
    sourceMerchantCollectedAt: String(row.sourceMerchantCollectedAt || "").trim(),
    sourceStatus: String(row.sourceStatus || "").trim(),
    createdAt: String(row.createdAt || "").trim(),
    updatedAt: String(row.updatedAt || "").trim(),
    updatedBy: String(row.updatedBy || "").trim(),
  };
}

function emptyStore(): PaymentExceptionReviewStore {
  return { version: 1, updatedAt: "", records: [], audit: [] };
}

export function readPaymentExceptionReviewStore(): PaymentExceptionReviewStore {
  try {
    const file = paymentExceptionReviewStorePath();
    if (!fs.existsSync(file)) return emptyStore();
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!payload || typeof payload !== "object") return emptyStore();
    return {
      version: 1,
      updatedAt: String(payload.updatedAt || ""),
      records: (Array.isArray(payload.records) ? payload.records : []).map(parseRecord).filter(Boolean) as PaymentExceptionReviewRecord[],
      audit: (Array.isArray(payload.audit) ? payload.audit : []) as PaymentExceptionReviewAuditEvent[],
    };
  } catch {
    return emptyStore();
  }
}

function nextTimestamp(...values: string[]): string {
  const latest = values.reduce((maximum, value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.max(maximum, parsed) : maximum;
  }, 0);
  return new Date(Math.max(Date.now(), latest + 1)).toISOString();
}

function writeStore(store: PaymentExceptionReviewStore): void {
  const file = paymentExceptionReviewStorePath();
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const sorted = {
    ...store,
    records: store.records.slice().sort((left, right) =>
      `${left.date}|${left.exceptionType}|${left.reference}`.localeCompare(`${right.date}|${right.exceptionType}|${right.reference}`)),
  };
  fs.writeFileSync(temporary, JSON.stringify(sorted, null, 2), { encoding: "utf8", mode: 0o660 });
  fs.chmodSync(temporary, 0o660);
  fs.renameSync(temporary, file);
}

export function paymentExceptionReviewRecord(exceptionId: string): PaymentExceptionReviewRecord | null {
  const normalized = validExceptionId(exceptionId);
  return readPaymentExceptionReviewStore().records.find((record) => record.exceptionId === normalized) || null;
}

export function savePaymentExceptionReview(
  input: SavePaymentExceptionReviewInput,
  expected: { storeUpdatedAt: string; recordUpdatedAt: string },
): PaymentExceptionReviewRecord {
  const exceptionId = validExceptionId(input.exceptionId);
  if (!exceptionId || !PAYMENT_EXCEPTION_REVIEW_DISPOSITIONS.includes(input.disposition)) {
    throw new Error("A valid payment exception and review disposition are required.");
  }
  const store = readPaymentExceptionReviewStore();
  if (store.updatedAt !== expected.storeUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Payment-exception review state changed after this request was prepared.");
  }
  const existingIndex = store.records.findIndex((record) => record.exceptionId === exceptionId);
  const existing = existingIndex >= 0 ? store.records[existingIndex] : null;
  if (String(existing?.updatedAt || "") !== expected.recordUpdatedAt) {
    throw new Error("VERSION_CONFLICT: The payment-exception review changed after this request was prepared.");
  }
  const now = nextTimestamp(store.updatedAt, existing?.updatedAt || "");
  const saved: PaymentExceptionReviewRecord = {
    ...input,
    exceptionId,
    recordId: existing?.recordId || randomUUID(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (existingIndex >= 0) store.records.splice(existingIndex, 1, saved);
  else store.records.push(saved);
  store.audit.push({
    eventId: randomUUID(),
    recordId: saved.recordId,
    action: "payment_exception_review_recorded",
    occurredAt: now,
    actor: saved.updatedBy,
    before: existing,
    after: saved,
  });
  writeStore({ ...store, updatedAt: now });
  return saved;
}
