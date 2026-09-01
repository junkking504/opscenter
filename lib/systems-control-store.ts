import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SYSTEMS_REVIEW_DISPOSITIONS = [
  "monitor",
  "owner_follow_up",
  "credential_follow_up",
  "source_recovery",
  "no_issue_confirmed",
] as const;

export type SystemsReviewDisposition = (typeof SYSTEMS_REVIEW_DISPOSITIONS)[number];

export type SystemsIntegrationReviewRecord = {
  recordId: string;
  integrationId: string;
  integrationLabel: string;
  disposition: SystemsReviewDisposition;
  owner: string;
  nextAction: string;
  note: string;
  sourceObservationKey: string;
  sourceStatus: string;
  sourceObservedAt: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type SystemsIntegrationReviewAuditEvent = {
  eventId: string;
  recordId: string;
  action: "integration_review_recorded";
  occurredAt: string;
  actor: string;
  before: SystemsIntegrationReviewRecord | null;
  after: SystemsIntegrationReviewRecord;
};

export type SystemsIntegrationReviewStore = {
  version: 1;
  updatedAt: string;
  records: SystemsIntegrationReviewRecord[];
  audit: SystemsIntegrationReviewAuditEvent[];
};

export type SaveSystemsIntegrationReviewInput = Omit<
  SystemsIntegrationReviewRecord,
  "recordId" | "createdAt" | "updatedAt"
>;

function dataRoot(): string {
  const configured = String(process.env.OPSBOT_DATA_DIR || "").trim();
  return configured || path.join(process.cwd(), "data");
}

export function systemsIntegrationReviewStorePath(): string {
  const configured = String(process.env.SYSTEMS_INTEGRATION_REVIEW_FILE || "").trim();
  return configured || path.join(dataRoot(), "platform", "integration_reviews.json");
}

export function normalizeIntegrationId(value: unknown): string {
  const id = String(value || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{2,63}$/.test(id) ? id : "";
}

function parseRecord(value: unknown): SystemsIntegrationReviewRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const integrationId = normalizeIntegrationId(row.integrationId);
  const disposition = String(row.disposition || "") as SystemsReviewDisposition;
  if (!integrationId || !SYSTEMS_REVIEW_DISPOSITIONS.includes(disposition)) return null;
  return {
    recordId: String(row.recordId || randomUUID()),
    integrationId,
    integrationLabel: String(row.integrationLabel || integrationId).trim(),
    disposition,
    owner: String(row.owner || "").trim(),
    nextAction: String(row.nextAction || "").trim(),
    note: String(row.note || "").trim(),
    sourceObservationKey: String(row.sourceObservationKey || "").trim(),
    sourceStatus: String(row.sourceStatus || "").trim(),
    sourceObservedAt: String(row.sourceObservedAt || "").trim(),
    createdAt: String(row.createdAt || "").trim(),
    updatedAt: String(row.updatedAt || "").trim(),
    updatedBy: String(row.updatedBy || "").trim(),
  };
}

function emptyStore(): SystemsIntegrationReviewStore {
  return { version: 1, updatedAt: "", records: [], audit: [] };
}

export function readSystemsIntegrationReviewStore(): SystemsIntegrationReviewStore {
  try {
    const file = systemsIntegrationReviewStorePath();
    if (!fs.existsSync(file)) return emptyStore();
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!payload || typeof payload !== "object") return emptyStore();
    return {
      version: 1,
      updatedAt: String(payload.updatedAt || ""),
      records: (Array.isArray(payload.records) ? payload.records : []).map(parseRecord).filter(Boolean) as SystemsIntegrationReviewRecord[],
      audit: (Array.isArray(payload.audit) ? payload.audit : []) as SystemsIntegrationReviewAuditEvent[],
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

function writeStore(store: SystemsIntegrationReviewStore): void {
  const file = systemsIntegrationReviewStorePath();
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const sorted = {
    ...store,
    records: store.records.slice().sort((left, right) => left.integrationLabel.localeCompare(right.integrationLabel)),
  };
  fs.writeFileSync(temporary, JSON.stringify(sorted, null, 2), { encoding: "utf8", mode: 0o660 });
  fs.chmodSync(temporary, 0o660);
  fs.renameSync(temporary, file);
}

export function systemsIntegrationReviewRecord(integrationId: string): SystemsIntegrationReviewRecord | null {
  const normalized = normalizeIntegrationId(integrationId);
  return readSystemsIntegrationReviewStore().records.find((record) => record.integrationId === normalized) || null;
}

export function saveSystemsIntegrationReview(
  input: SaveSystemsIntegrationReviewInput,
  expected: { storeUpdatedAt: string; recordUpdatedAt: string },
): SystemsIntegrationReviewRecord {
  const integrationId = normalizeIntegrationId(input.integrationId);
  if (!integrationId || !SYSTEMS_REVIEW_DISPOSITIONS.includes(input.disposition)) {
    throw new Error("A valid integration and review disposition are required.");
  }
  const store = readSystemsIntegrationReviewStore();
  if (store.updatedAt !== expected.storeUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Integration review state changed after this request was prepared.");
  }
  const existingIndex = store.records.findIndex((record) => record.integrationId === integrationId);
  const existing = existingIndex >= 0 ? store.records[existingIndex] : null;
  if (String(existing?.updatedAt || "") !== expected.recordUpdatedAt) {
    throw new Error("VERSION_CONFLICT: The integration review changed after this request was prepared.");
  }
  const now = nextTimestamp(store.updatedAt, existing?.updatedAt || "");
  const saved: SystemsIntegrationReviewRecord = {
    ...input,
    integrationId,
    recordId: existing?.recordId || randomUUID(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (existingIndex >= 0) store.records.splice(existingIndex, 1, saved);
  else store.records.push(saved);
  store.audit.push({
    eventId: randomUUID(),
    recordId: saved.recordId,
    action: "integration_review_recorded",
    occurredAt: now,
    actor: saved.updatedBy,
    before: existing,
    after: saved,
  });
  writeStore({ ...store, updatedAt: now });
  return saved;
}
