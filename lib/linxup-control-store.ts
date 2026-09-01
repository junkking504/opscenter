import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const LINXUP_REVIEW_DISPOSITIONS = [
  "monitor",
  "provider_follow_up",
  "mapping_follow_up",
  "no_issue_confirmed",
] as const;

export type LinxupReviewDisposition = (typeof LINXUP_REVIEW_DISPOSITIONS)[number];

export type LinxupDeviceReviewRecord = {
  recordId: string;
  truck: string;
  disposition: LinxupReviewDisposition;
  note: string;
  sourceDate: string;
  sourceObservationKey: string;
  sourceFreshness: string;
  sourceDeliveryMode: string;
  sourceLastGpsUpdate: string;
  sourceMappingStatus: string;
  sourceHasCoordinates: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type LinxupDeviceReviewAuditEvent = {
  eventId: string;
  recordId: string;
  action: "device_review_recorded";
  occurredAt: string;
  actor: string;
  before: LinxupDeviceReviewRecord | null;
  after: LinxupDeviceReviewRecord;
};

export type LinxupDeviceReviewStore = {
  version: 1;
  updatedAt: string;
  records: LinxupDeviceReviewRecord[];
  audit: LinxupDeviceReviewAuditEvent[];
};

export type SaveLinxupDeviceReviewInput = Omit<
  LinxupDeviceReviewRecord,
  "recordId" | "createdAt" | "updatedAt"
>;

export type LinxupDeviceReviewExpectedState = {
  storeUpdatedAt: string;
  recordUpdatedAt: string;
};

function dataRoot(): string {
  const configured = String(process.env.OPSBOT_DATA_DIR || "").trim();
  return configured || path.join(process.cwd(), "data");
}

export function linxupDeviceReviewStorePath(): string {
  const configured = String(process.env.LINXUP_DEVICE_REVIEW_FILE || "").trim();
  return configured || path.join(dataRoot(), "fleet", "linxup_device_reviews.json");
}

function normalizeTruck(value: unknown): string {
  const match = String(value || "").trim().match(/truck\s*#?\s*(\d+)/i);
  return match ? `Truck# ${match[1]}` : "";
}

function parseRecord(value: unknown): LinxupDeviceReviewRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const truck = normalizeTruck(row.truck);
  const disposition = String(row.disposition || "") as LinxupReviewDisposition;
  if (!truck || !LINXUP_REVIEW_DISPOSITIONS.includes(disposition)) return null;
  return {
    recordId: String(row.recordId || randomUUID()),
    truck,
    disposition,
    note: String(row.note || "").trim(),
    sourceDate: String(row.sourceDate || "").trim(),
    sourceObservationKey: String(row.sourceObservationKey || "").trim(),
    sourceFreshness: String(row.sourceFreshness || "").trim(),
    sourceDeliveryMode: String(row.sourceDeliveryMode || "").trim(),
    sourceLastGpsUpdate: String(row.sourceLastGpsUpdate || "").trim(),
    sourceMappingStatus: String(row.sourceMappingStatus || "").trim(),
    sourceHasCoordinates: row.sourceHasCoordinates === true,
    createdAt: String(row.createdAt || "").trim(),
    updatedAt: String(row.updatedAt || "").trim(),
    updatedBy: String(row.updatedBy || "").trim(),
  };
}

function emptyStore(): LinxupDeviceReviewStore {
  return { version: 1, updatedAt: "", records: [], audit: [] };
}

export function readLinxupDeviceReviewStore(): LinxupDeviceReviewStore {
  try {
    const file = linxupDeviceReviewStorePath();
    if (!fs.existsSync(file)) return emptyStore();
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!payload || typeof payload !== "object") return emptyStore();
    return {
      version: 1,
      updatedAt: String(payload.updatedAt || ""),
      records: (Array.isArray(payload.records) ? payload.records : []).map(parseRecord).filter(Boolean) as LinxupDeviceReviewRecord[],
      audit: (Array.isArray(payload.audit) ? payload.audit : []) as LinxupDeviceReviewAuditEvent[],
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

function writeStore(store: LinxupDeviceReviewStore): void {
  const file = linxupDeviceReviewStorePath();
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const sorted = {
    ...store,
    records: store.records.slice().sort((left, right) => left.truck.localeCompare(right.truck, undefined, { numeric: true })),
  };
  fs.writeFileSync(temporary, JSON.stringify(sorted, null, 2), { encoding: "utf8", mode: 0o660 });
  fs.chmodSync(temporary, 0o660);
  fs.renameSync(temporary, file);
}

export function linxupDeviceReviewRecord(truck: string): LinxupDeviceReviewRecord | null {
  const normalized = normalizeTruck(truck);
  return readLinxupDeviceReviewStore().records.find((record) => record.truck === normalized) || null;
}

export function saveLinxupDeviceReview(
  input: SaveLinxupDeviceReviewInput,
  expected: LinxupDeviceReviewExpectedState,
): LinxupDeviceReviewRecord {
  const truck = normalizeTruck(input.truck);
  if (!truck || !LINXUP_REVIEW_DISPOSITIONS.includes(input.disposition)) {
    throw new Error("A valid LinxUp truck and review disposition are required.");
  }
  const store = readLinxupDeviceReviewStore();
  if (store.updatedAt !== expected.storeUpdatedAt) {
    throw new Error("VERSION_CONFLICT: LinxUp review state changed after this request was prepared.");
  }
  const existingIndex = store.records.findIndex((record) => record.truck === truck);
  const existing = existingIndex >= 0 ? store.records[existingIndex] : null;
  if (String(existing?.updatedAt || "") !== expected.recordUpdatedAt) {
    throw new Error("VERSION_CONFLICT: The truck review changed after this request was prepared.");
  }
  const now = nextTimestamp(store.updatedAt, existing?.updatedAt || "");
  const saved: LinxupDeviceReviewRecord = {
    ...input,
    truck,
    recordId: existing?.recordId || randomUUID(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (existingIndex >= 0) store.records.splice(existingIndex, 1, saved);
  else store.records.push(saved);
  store.audit.push({
    eventId: randomUUID(),
    recordId: saved.recordId,
    action: "device_review_recorded",
    occurredAt: now,
    actor: saved.updatedBy,
    before: existing,
    after: saved,
  });
  writeStore({ ...store, updatedAt: now });
  return saved;
}
