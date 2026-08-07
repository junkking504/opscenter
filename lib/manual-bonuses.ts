import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type ManualBonusEntry = {
  entryId: string;
  employeeName: string;
  normalizedEmployeeName: string;
  workDate: string;
  amount: number;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type ManualBonusEmployeeSummary = {
  employeeName: string;
  normalizedEmployeeName: string;
  totalAmount: number;
  entries: ManualBonusEntry[];
};

export type ManualBonusDateSummary = {
  workDate: string;
  totalAmount: number;
  entries: ManualBonusEntry[];
  byEmployee: Record<string, ManualBonusEmployeeSummary>;
};

export type ManualBonusStore = {
  version: 1;
  updatedAt: string;
  entries: ManualBonusEntry[];
};

export type ManualBonusUpsertInput = {
  entryId?: string;
  employeeName: string;
  workDate: string;
  amount: number;
  note?: string;
};

const STORE_FILE = "manual_bonus_entries.json";

function storeDir(): string {
  return path.join(process.cwd(), "data", "manual_bonuses");
}

export function manualBonusStorePath(): string {
  return path.join(storeDir(), STORE_FILE);
}

export function normalizeEmployeeKey(value: string): string {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/\s+/g, " ");

  if (!raw.includes(",")) return raw;

  const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`.trim().toLowerCase();

  return raw.replace(/[,]+/g, " ");
}

function isValidDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function sortEntries(entries: ManualBonusEntry[]): ManualBonusEntry[] {
  return entries
    .slice()
    .sort((a, b) => {
      const created = String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
      if (created !== 0) return created;
      return String(a.entryId || "").localeCompare(String(b.entryId || ""));
    });
}

function readJsonFile(filePath: string): ManualBonusStore | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return {
      version: 1,
      updatedAt: String(parsed.updatedAt || ""),
      entries: entries
        .map((entry: Record<string, unknown>) => {
          const employeeName = String(entry.employeeName || "").trim();
          const workDate = String(entry.workDate || "").trim();
          const amount = Number(entry.amount || 0);
          if (!employeeName || !isValidDateKey(workDate) || !Number.isFinite(amount)) return null;

          return {
            entryId: String(entry.entryId || "").trim(),
            employeeName,
            normalizedEmployeeName: String(entry.normalizedEmployeeName || normalizeEmployeeKey(employeeName)),
            workDate,
            amount: roundMoney(Math.max(0, amount)),
            note: String(entry.note || ""),
            createdAt: String(entry.createdAt || ""),
            updatedAt: String(entry.updatedAt || ""),
          } satisfies ManualBonusEntry;
        })
        .filter(Boolean) as ManualBonusEntry[],
    };
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, store: ManualBonusStore): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const payload = JSON.stringify(store, null, 2);
  const tempFile = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  fs.writeFileSync(tempFile, payload, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tempFile, filePath);
}

export function readManualBonusStore(): ManualBonusStore {
  const store = readJsonFile(manualBonusStorePath());
  return (
    store || {
      version: 1,
      updatedAt: "",
      entries: [],
    }
  );
}

export function writeManualBonusStore(store: ManualBonusStore): void {
  writeJsonFile(manualBonusStorePath(), {
    version: 1,
    updatedAt: store.updatedAt || new Date().toISOString(),
    entries: sortEntries(store.entries),
  });
}

export function summarizeManualBonusesForDate(date: string): ManualBonusDateSummary {
  if (!isValidDateKey(date)) {
    return {
      workDate: date,
      totalAmount: 0,
      entries: [],
      byEmployee: {},
    };
  }

  const store = readManualBonusStore();
  const entries = sortEntries(store.entries.filter((entry) => entry.workDate === date));
  const byEmployee: Record<string, ManualBonusEmployeeSummary> = {};
  let totalAmount = 0;

  for (const entry of entries) {
    totalAmount += entry.amount;
    const key = entry.normalizedEmployeeName || normalizeEmployeeKey(entry.employeeName);
    const existing = byEmployee[key] || {
      employeeName: entry.employeeName,
      normalizedEmployeeName: key,
      totalAmount: 0,
      entries: [],
    };

    existing.totalAmount = roundMoney(existing.totalAmount + entry.amount);
    existing.entries.push(entry);
    byEmployee[key] = existing;
  }

  return {
    workDate: date,
    totalAmount: roundMoney(totalAmount),
    entries,
    byEmployee,
  };
}

export function manualBonusForEmployee(date: string, employeeName: string): number {
  const summary = summarizeManualBonusesForDate(date);
  const key = normalizeEmployeeKey(employeeName);
  return roundMoney(summary.byEmployee[key]?.totalAmount || 0);
}

export function manualBonusEntriesForEmployee(date: string, employeeName: string): ManualBonusEntry[] {
  const summary = summarizeManualBonusesForDate(date);
  const key = normalizeEmployeeKey(employeeName);
  return summary.byEmployee[key]?.entries || [];
}

export function upsertManualBonusEntry(input: ManualBonusUpsertInput): ManualBonusEntry | null {
  const employeeName = String(input.employeeName || "").trim();
  const workDate = String(input.workDate || "").trim();
  const normalizedEmployeeName = normalizeEmployeeKey(employeeName);
  const amount = Number(input.amount);
  const note = String(input.note || "").trim();
  const entryId = String(input.entryId || "").trim();

  if (!employeeName || !isValidDateKey(workDate) || !Number.isFinite(amount)) return null;

  const now = new Date().toISOString();
  const store = readManualBonusStore();
  const rounded = roundMoney(Math.max(0, amount));

  if (rounded <= 0) {
    if (!entryId) return null;
    const remaining = store.entries.filter((entry) => entry.entryId !== entryId);
    if (remaining.length === store.entries.length) return null;

    writeManualBonusStore({
      version: 1,
      updatedAt: now,
      entries: remaining,
    });
    return null;
  }

  const existingIndex = entryId ? store.entries.findIndex((entry) => entry.entryId === entryId) : -1;
  const existing = existingIndex >= 0 ? store.entries[existingIndex] : null;

  const saved: ManualBonusEntry = {
    entryId: existing?.entryId || entryId || randomUUID(),
    employeeName,
    normalizedEmployeeName,
    workDate,
    amount: rounded,
    note,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    store.entries.splice(existingIndex, 1, saved);
  } else {
    store.entries.push(saved);
  }

  writeManualBonusStore({
    version: 1,
    updatedAt: now,
    entries: store.entries,
  });

  return saved;
}

export function deleteManualBonusEntry(entryId: string): boolean {
  const id = String(entryId || "").trim();
  if (!id) return false;

  const store = readManualBonusStore();
  const remaining = store.entries.filter((entry) => entry.entryId !== id);
  if (remaining.length === store.entries.length) return false;

  writeManualBonusStore({
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: remaining,
  });
  return true;
}

function valueNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rowName(row: Record<string, any>): string {
  return String(row.name || row.employee || row.employee_name || "").trim();
}

function rowRevenueBonus(row: Record<string, any>): number {
  return valueNumber(
    row.revenue_bonus ??
      row.revenueBonus ??
      row.bonus ??
      row.daily_bonus ??
      row.bonus_pay ??
      row.profit_bonus ??
      row.profit_sharing_bonus ??
      row.employee_bonus ??
      0,
  );
}

function rowOtherBonus(row: Record<string, any>): number {
  return valueNumber(row.other_bonus ?? row.otherBonus ?? 0);
}

function rowManualBonus(row: Record<string, any>): number {
  return valueNumber(row.manual_bonus ?? row.manualBonus ?? 0);
}

function roundIfFinite(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function applyBonusFields(row: Record<string, any>, manualAmount: number): void {
  const revenueBonus = roundIfFinite(rowRevenueBonus(row));
  const otherBonus = roundIfFinite(rowOtherBonus(row));
  const manualBonus = roundIfFinite(manualAmount);
  const totalBonus = roundIfFinite(revenueBonus + otherBonus + manualBonus);

  row.revenue_bonus = revenueBonus;
  row.manual_bonus = manualBonus;
  row.other_bonus = otherBonus;
  row.total_bonus = totalBonus;
  row.bonus = totalBonus;
  row.bonuses = totalBonus;
  row.daily_bonus = totalBonus;
  row.daily_bonus_payroll = totalBonus;
  row.total_pay = roundIfFinite(
    valueNumber(row.regular_pay ?? row.hourly_pay ?? row.base_pay ?? row.pay ?? 0)
      + valueNumber(row.overtime_pay ?? 0)
      + valueNumber(row.tips ?? row.tip ?? 0)
      + totalBonus,
  );
}

export function applyManualBonusesToMetrics(metrics: Record<string, any> | null, date: string): Record<string, any> | null {
  if (!metrics || !isValidDateKey(date)) return metrics;

  const summary = summarizeManualBonusesForDate(date);
  const summaryByEmployee = summary.byEmployee;
  const rowKeys = ["employee_leaderboard", "payroll_records", "crew", "employees"];

  for (const key of rowKeys) {
    const rows = metrics[key];
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const employee = rowName(row);
      if (!employee) continue;
      const normalized = normalizeEmployeeKey(employee);
      const manualAmount = summaryByEmployee[normalized]?.totalAmount || 0;
      applyBonusFields(row, manualAmount);
      row.manual_bonus_entries = summaryByEmployee[normalized]?.entries || [];
    }
  }

  const basePayroll = valueNumber(metrics.total_payroll ?? metrics.payroll ?? 0);
  const baseBonuses = valueNumber(metrics.bonuses ?? metrics.daily_bonus_payroll ?? metrics.total_bonus ?? 0);
  const manualTotal = summary.totalAmount;
  const adjustedBonusTotal = roundIfFinite(baseBonuses + manualTotal);
  const adjustedPayroll = roundIfFinite(basePayroll + manualTotal);

  metrics.manual_bonus_entries = summary.entries;
  metrics.manual_bonus_by_employee = summaryByEmployee;
  metrics.manual_bonus_total = manualTotal;
  metrics.manual_bonus_payroll = manualTotal;
  metrics.total_bonus = adjustedBonusTotal;
  metrics.bonuses = adjustedBonusTotal;
  metrics.daily_bonus_payroll = adjustedBonusTotal;
  metrics.total_payroll = adjustedPayroll;
  metrics.payroll = adjustedPayroll;

  return metrics;
}
