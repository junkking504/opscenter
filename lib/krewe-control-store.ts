import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { normalizeEmployeeKey } from "@/lib/manual-bonuses";

export type KreweAvailabilityStatus = "available" | "unavailable" | "called_in";
export type KreweCallInRole = "driver" | "crew" | "";

export type KreweAvailabilityRecord = {
  recordId: string;
  employeeName: string;
  normalizedEmployeeName: string;
  targetDate: string;
  status: KreweAvailabilityStatus;
  role: KreweCallInRole;
  note: string;
  source: "human_confirmation";
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type KreweControlAuditEvent = {
  eventId: string;
  recordId: string;
  action: "availability_recorded" | "call_in_scheduled";
  occurredAt: string;
  actor: string;
  before: KreweAvailabilityRecord | null;
  after: KreweAvailabilityRecord;
};

export type KreweControlStore = {
  version: 1;
  updatedAt: string;
  records: KreweAvailabilityRecord[];
  audit: KreweControlAuditEvent[];
};

export type KreweControlExpectedState = {
  storeUpdatedAt: string;
  recordUpdatedAt?: string;
};

type SaveInput = {
  employeeName: string;
  targetDate: string;
  status: KreweAvailabilityStatus;
  role?: KreweCallInRole;
  note: string;
  updatedBy: string;
  action: KreweControlAuditEvent["action"];
};

const STORE_FILE = "availability.json";

function dataRoot(): string {
  const configured = String(process.env.OPSBOT_DATA_DIR || "").trim();
  return configured || path.join(process.cwd(), "data");
}

export function kreweControlStorePath(): string {
  const configured = String(process.env.KREWE_CONTROL_FILE || "").trim();
  return configured || path.join(dataRoot(), "crew_control", STORE_FILE);
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseRecord(value: unknown): KreweAvailabilityRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const employeeName = String(row.employeeName || "").trim();
  const targetDate = String(row.targetDate || "").trim();
  const status = String(row.status || "") as KreweAvailabilityStatus;
  const role = String(row.role || "") as KreweCallInRole;
  if (
    !employeeName
    || !validDate(targetDate)
    || !["available", "unavailable", "called_in"].includes(status)
    || !["", "driver", "crew"].includes(role)
    || (status === "called_in" && !role)
  ) return null;
  return {
    recordId: String(row.recordId || randomUUID()),
    employeeName,
    normalizedEmployeeName: String(row.normalizedEmployeeName || normalizeEmployeeKey(employeeName)),
    targetDate,
    status,
    role,
    note: String(row.note || "").trim(),
    source: "human_confirmation",
    createdAt: String(row.createdAt || ""),
    updatedAt: String(row.updatedAt || ""),
    updatedBy: String(row.updatedBy || ""),
  };
}

function emptyStore(): KreweControlStore {
  return { version: 1, updatedAt: "", records: [], audit: [] };
}

export function readKreweControlStore(): KreweControlStore {
  const file = kreweControlStorePath();
  try {
    if (!fs.existsSync(file)) return emptyStore();
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return emptyStore();
    return {
      version: 1,
      updatedAt: String(parsed.updatedAt || ""),
      records: (Array.isArray(parsed.records) ? parsed.records : []).map(parseRecord).filter(Boolean) as KreweAvailabilityRecord[],
      audit: (Array.isArray(parsed.audit) ? parsed.audit : []) as KreweControlAuditEvent[],
    };
  } catch {
    return emptyStore();
  }
}

function writeKreweControlStore(store: KreweControlStore): void {
  const file = kreweControlStorePath();
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const sorted = {
    ...store,
    records: store.records.slice().sort((left, right) =>
      left.targetDate.localeCompare(right.targetDate)
      || left.employeeName.localeCompare(right.employeeName)),
  };
  fs.writeFileSync(temporary, JSON.stringify(sorted, null, 2), { encoding: "utf8", mode: 0o660 });
  fs.chmodSync(temporary, 0o660);
  fs.renameSync(temporary, file);
}

function nextTimestamp(...values: string[]): string {
  const latest = values.reduce((maximum, value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.max(maximum, parsed) : maximum;
  }, 0);
  return new Date(Math.max(Date.now(), latest + 1)).toISOString();
}

export function kreweAvailabilityRecord(targetDate: string, employeeName: string): KreweAvailabilityRecord | null {
  const normalized = normalizeEmployeeKey(employeeName);
  return readKreweControlStore().records.find((record) =>
    record.targetDate === targetDate && record.normalizedEmployeeName === normalized) || null;
}

export function saveKreweControlRecord(
  input: SaveInput,
  expected: KreweControlExpectedState,
): KreweAvailabilityRecord {
  const employeeName = String(input.employeeName || "").trim();
  const normalizedEmployeeName = normalizeEmployeeKey(employeeName);
  const targetDate = String(input.targetDate || "").trim();
  if (!employeeName || !normalizedEmployeeName || !validDate(targetDate)) {
    throw new Error("A valid Krewe employee and target date are required.");
  }
  const store = readKreweControlStore();
  if (store.updatedAt !== expected.storeUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Krewe control state changed after this request was prepared.");
  }
  const existingIndex = store.records.findIndex((record) =>
    record.targetDate === targetDate && record.normalizedEmployeeName === normalizedEmployeeName);
  const existing = existingIndex >= 0 ? store.records[existingIndex] : null;
  if (String(existing?.updatedAt || "") !== String(expected.recordUpdatedAt || "")) {
    throw new Error("VERSION_CONFLICT: The employee availability record changed after this request was prepared.");
  }
  if (input.action === "availability_recorded" && existing?.status === "called_in") {
    throw new Error("A committed call-in cannot be replaced by a direct availability update.");
  }
  if (input.action === "call_in_scheduled" && existing?.status === "unavailable") {
    throw new Error("The employee is currently recorded as unavailable.");
  }
  if (input.action === "call_in_scheduled" && existing?.status === "called_in") {
    throw new Error("The employee already has a committed call-in for this date.");
  }
  const now = nextTimestamp(store.updatedAt, existing?.updatedAt || "");
  const saved: KreweAvailabilityRecord = {
    recordId: existing?.recordId || randomUUID(),
    employeeName,
    normalizedEmployeeName,
    targetDate,
    status: input.status,
    role: input.role || "",
    note: String(input.note || "").trim(),
    source: "human_confirmation",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    updatedBy: String(input.updatedBy || "Authenticated OpsCenter user").trim(),
  };
  if (existingIndex >= 0) store.records.splice(existingIndex, 1, saved);
  else store.records.push(saved);
  store.audit.push({
    eventId: randomUUID(),
    recordId: saved.recordId,
    action: input.action,
    occurredAt: now,
    actor: saved.updatedBy,
    before: existing,
    after: saved,
  });
  writeKreweControlStore({ ...store, updatedAt: now });
  return saved;
}
