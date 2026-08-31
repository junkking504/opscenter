import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type PayrollCorrection = {
  correctionId: string;
  employeeName: string;
  normalizedEmployeeName: string;
  workDate: string;
  clockIn: string;
  clockOut: string;
  hourlyRate: number;
  note: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type PayrollCorrectionAuditEvent = {
  eventId: string;
  correctionId: string;
  action: "saved" | "removed";
  occurredAt: string;
  actor: string;
  before: PayrollCorrection | null;
  after: PayrollCorrection | null;
};

export type PayrollCorrectionStore = {
  version: 1;
  updatedAt: string;
  corrections: PayrollCorrection[];
  audit: PayrollCorrectionAuditEvent[];
};

export type PayrollCorrectionUpsertInput = {
  employeeName: string;
  workDate: string;
  clockIn: string;
  clockOut?: string;
  hourlyRate: number;
  note: string;
  updatedBy?: string;
};

export type PayrollCorrectionExpectedState = {
  storeUpdatedAt: string;
  correctionUpdatedAt?: string;
};

const STORE_FILE = "payroll_corrections.json";

function dataRoot(): string {
  const configured = String(process.env.OPSBOT_DATA_DIR || "").trim();
  return configured || path.join(process.cwd(), "data");
}

export function payrollCorrectionStorePath(): string {
  return path.join(dataRoot(), "payroll_corrections", STORE_FILE);
}

export function normalizePayrollEmployeeKey(value: string): string {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/\s+/g, " ");

  if (!raw.includes(",")) return raw;
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : raw.replace(/,+/g, " ");
}

function isValidDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function normalizeClock(value: unknown): string {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  const match = raw.match(/^(\d{1,2}):(\d{2}) (AM|PM)$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${match[3]}`;
}

function parseCorrection(value: unknown): PayrollCorrection | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const employeeName = String(row.employeeName || "").trim();
  const workDate = String(row.workDate || "").trim();
  const clockIn = normalizeClock(row.clockIn);
  const rawClockOut = String(row.clockOut || "").trim();
  const clockOut = rawClockOut ? normalizeClock(rawClockOut) : "";
  const hourlyRate = Number(row.hourlyRate);
  const note = String(row.note || "").trim();
  if (
    !employeeName ||
    !isValidDateKey(workDate) ||
    !clockIn ||
    (rawClockOut && !clockOut) ||
    !Number.isFinite(hourlyRate) ||
    hourlyRate <= 0 ||
    !note
  ) {
    return null;
  }

  return {
    correctionId: String(row.correctionId || randomUUID()),
    employeeName,
    normalizedEmployeeName: String(
      row.normalizedEmployeeName || normalizePayrollEmployeeKey(employeeName),
    ),
    workDate,
    clockIn,
    clockOut,
    hourlyRate: Number(hourlyRate.toFixed(2)),
    note,
    createdAt: String(row.createdAt || ""),
    updatedAt: String(row.updatedAt || ""),
    updatedBy: String(row.updatedBy || ""),
  };
}

function emptyStore(): PayrollCorrectionStore {
  return { version: 1, updatedAt: "", corrections: [], audit: [] };
}

export function readPayrollCorrectionStore(): PayrollCorrectionStore {
  const filePath = payrollCorrectionStorePath();
  try {
    if (!fs.existsSync(filePath)) return emptyStore();
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return emptyStore();
    return {
      version: 1,
      updatedAt: String(parsed.updatedAt || ""),
      corrections: (Array.isArray(parsed.corrections) ? parsed.corrections : [])
        .map(parseCorrection)
        .filter(Boolean) as PayrollCorrection[],
      audit: (Array.isArray(parsed.audit) ? parsed.audit : []) as PayrollCorrectionAuditEvent[],
    };
  } catch {
    return emptyStore();
  }
}

function writePayrollCorrectionStore(store: PayrollCorrectionStore): void {
  const filePath = payrollCorrectionStorePath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempFile = path.join(dir, `.${STORE_FILE}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempFile, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o660 });
  fs.chmodSync(tempFile, 0o660);
  fs.renameSync(tempFile, filePath);
}

export function payrollCorrectionsForDate(date: string): Record<string, PayrollCorrection> {
  if (!isValidDateKey(date)) return {};
  const rows: Record<string, PayrollCorrection> = {};
  for (const correction of readPayrollCorrectionStore().corrections) {
    if (correction.workDate === date) rows[correction.normalizedEmployeeName] = correction;
  }
  return rows;
}

export function payrollCorrectionForEmployee(
  date: string,
  employeeName: string,
): PayrollCorrection | null {
  return payrollCorrectionsForDate(date)[normalizePayrollEmployeeKey(employeeName)] || null;
}

export function upsertPayrollCorrection(
  input: PayrollCorrectionUpsertInput,
  expected?: PayrollCorrectionExpectedState,
): PayrollCorrection | null {
  const employeeName = String(input.employeeName || "").trim();
  const normalizedEmployeeName = normalizePayrollEmployeeKey(employeeName);
  const workDate = String(input.workDate || "").trim();
  const rawClockIn = String(input.clockIn || "").trim();
  const rawClockOut = String(input.clockOut || "").trim();
  const clockIn = normalizeClock(rawClockIn);
  const clockOut = rawClockOut ? normalizeClock(rawClockOut) : "";
  const hourlyRate = Number(input.hourlyRate);
  const note = String(input.note || "").trim();
  const updatedBy = String(input.updatedBy || "Authenticated OpsCenter user").trim();

  if (
    !employeeName ||
    !normalizedEmployeeName ||
    !isValidDateKey(workDate) ||
    !clockIn ||
    (rawClockOut && !clockOut) ||
    !Number.isFinite(hourlyRate) ||
    hourlyRate <= 0 ||
    !note
  ) {
    return null;
  }

  const store = readPayrollCorrectionStore();
  if (expected && store.updatedAt !== expected.storeUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Payroll correction state changed after this request was prepared.");
  }
  const existingIndex = store.corrections.findIndex(
    (row) => row.workDate === workDate && row.normalizedEmployeeName === normalizedEmployeeName,
  );
  const existing = existingIndex >= 0 ? store.corrections[existingIndex] : null;
  if (expected && String(existing?.updatedAt || "") !== String(expected.correctionUpdatedAt || "")) {
    throw new Error("VERSION_CONFLICT: The payroll correction changed after this request was prepared.");
  }
  const latestTimestamp = Math.max(
    Date.parse(store.updatedAt) || 0,
    Date.parse(existing?.updatedAt || "") || 0,
  );
  const now = new Date(Math.max(Date.now(), latestTimestamp + 1)).toISOString();
  const saved: PayrollCorrection = {
    correctionId: existing?.correctionId || randomUUID(),
    employeeName,
    normalizedEmployeeName,
    workDate,
    clockIn,
    clockOut,
    hourlyRate: Number(hourlyRate.toFixed(2)),
    note,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    updatedBy,
  };

  if (existingIndex >= 0) store.corrections.splice(existingIndex, 1, saved);
  else store.corrections.push(saved);
  store.audit.push({
    eventId: randomUUID(),
    correctionId: saved.correctionId,
    action: "saved",
    occurredAt: now,
    actor: updatedBy,
    before: existing,
    after: saved,
  });
  writePayrollCorrectionStore({ ...store, updatedAt: now });
  return saved;
}

export function deletePayrollCorrection(
  workDate: string,
  employeeName: string,
  actor = "Authenticated OpsCenter user",
): boolean {
  const normalizedEmployeeName = normalizePayrollEmployeeKey(employeeName);
  if (!isValidDateKey(workDate) || !normalizedEmployeeName) return false;

  const store = readPayrollCorrectionStore();
  const existing = store.corrections.find(
    (row) => row.workDate === workDate && row.normalizedEmployeeName === normalizedEmployeeName,
  );
  if (!existing) return false;

  const now = new Date().toISOString();
  store.corrections = store.corrections.filter((row) => row.correctionId !== existing.correctionId);
  store.audit.push({
    eventId: randomUUID(),
    correctionId: existing.correctionId,
    action: "removed",
    occurredAt: now,
    actor,
    before: existing,
    after: null,
  });
  writePayrollCorrectionStore({ ...store, updatedAt: now });
  return true;
}
