import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export const MAINTENANCE_STATUSES = ["completed", "scheduled"] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const MAINTENANCE_SERVICE_TYPES = [
  "Oil change",
  "Tires",
  "Brakes",
  "Inspection",
  "Engine",
  "Transmission",
  "Electrical",
  "Hydraulics",
  "Body / lift",
  "Other",
] as const;

export type FleetMaintenanceRecord = {
  recordId: string;
  truck: string;
  serviceDate: string;
  status: MaintenanceStatus;
  serviceType: string;
  description: string;
  odometer: number | null;
  cost: number | null;
  vendor: string;
  nextServiceDate: string;
  nextServiceOdometer: number | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type FleetMaintenanceStore = {
  version: 1;
  updatedAt: string;
  records: FleetMaintenanceRecord[];
};

export type FleetMaintenanceInput = {
  recordId?: string;
  truck: string;
  serviceDate: string;
  status: MaintenanceStatus | string;
  serviceType: string;
  description?: string;
  odometer?: unknown;
  cost?: unknown;
  vendor?: string;
  nextServiceDate?: string;
  nextServiceOdometer?: unknown;
  notes?: string;
};

const STORE_FILE = "maintenance_records.json";

function storeDir(): string {
  return path.join(process.cwd(), "data", "fleet");
}

export function fleetMaintenanceStorePath(): string {
  return path.join(storeDir(), STORE_FILE);
}

function validDate(value: unknown, optional = false): boolean {
  const text = String(value || "").trim();
  return optional && !text ? true : /^\d{4}-\d{2}-\d{2}$/.test(text);
}

function nullableNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeTruck(value: unknown): string {
  const raw = String(value || "").trim();
  const match = raw.match(/(\d+)/);
  return match ? `Truck# ${match[1]}` : raw.replace(/\s+/g, " ");
}

function normalizeStatus(value: unknown): MaintenanceStatus {
  return value === "scheduled" ? "scheduled" : "completed";
}

function sortRecords(records: FleetMaintenanceRecord[]): FleetMaintenanceRecord[] {
  return records.slice().sort((a, b) => {
    const byDate = b.serviceDate.localeCompare(a.serviceDate);
    if (byDate !== 0) return byDate;
    const byTruck = a.truck.localeCompare(b.truck, undefined, { numeric: true });
    if (byTruck !== 0) return byTruck;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function parseRecord(value: Record<string, unknown>): FleetMaintenanceRecord | null {
  const truck = normalizeTruck(value.truck);
  const serviceDate = String(value.serviceDate || "").trim();
  const serviceType = String(value.serviceType || "").trim();
  if (!truck || !validDate(serviceDate) || !serviceType) return null;

  const nextServiceDate = String(value.nextServiceDate || "").trim();
  return {
    recordId: String(value.recordId || randomUUID()).trim(),
    truck,
    serviceDate,
    status: normalizeStatus(value.status),
    serviceType,
    description: String(value.description || "").trim(),
    odometer: nullableNonNegativeNumber(value.odometer),
    cost: nullableNonNegativeNumber(value.cost),
    vendor: String(value.vendor || "").trim(),
    nextServiceDate: validDate(nextServiceDate, true) ? nextServiceDate : "",
    nextServiceOdometer: nullableNonNegativeNumber(value.nextServiceOdometer),
    notes: String(value.notes || "").trim(),
    createdAt: String(value.createdAt || "").trim(),
    updatedAt: String(value.updatedAt || "").trim(),
  };
}

export function readFleetMaintenanceStore(): FleetMaintenanceStore {
  try {
    const filePath = fleetMaintenanceStorePath();
    if (!fs.existsSync(filePath)) return { version: 1, updatedAt: "", records: [] };
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const rawRecords = Array.isArray(parsed?.records) ? parsed.records : [];
    const records = rawRecords
      .map((record: unknown) => record && typeof record === "object" ? parseRecord(record as Record<string, unknown>) : null)
      .filter(Boolean) as FleetMaintenanceRecord[];
    return {
      version: 1,
      updatedAt: String(parsed?.updatedAt || ""),
      records: sortRecords(records),
    };
  } catch {
    return { version: 1, updatedAt: "", records: [] };
  }
}

function writeFleetMaintenanceStore(store: FleetMaintenanceStore): void {
  const filePath = fleetMaintenanceStorePath();
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const payload = JSON.stringify({
    version: 1,
    updatedAt: store.updatedAt || new Date().toISOString(),
    records: sortRecords(store.records),
  }, null, 2);
  const temporaryFile = path.join(directory, `.${STORE_FILE}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporaryFile, payload, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryFile, filePath);
}

export function upsertFleetMaintenanceRecord(input: FleetMaintenanceInput): FleetMaintenanceRecord | null {
  const truck = normalizeTruck(input.truck);
  const serviceDate = String(input.serviceDate || "").trim();
  const status = normalizeStatus(input.status);
  const serviceType = String(input.serviceType || "").trim();
  const nextServiceDate = String(input.nextServiceDate || "").trim();
  const rawOdometer = input.odometer;
  const rawCost = input.cost;
  const rawNextOdometer = input.nextServiceOdometer;

  if (!truck || !validDate(serviceDate) || !serviceType || !validDate(nextServiceDate, true)) return null;
  if (rawOdometer !== null && rawOdometer !== undefined && rawOdometer !== "" && nullableNonNegativeNumber(rawOdometer) === null) return null;
  if (rawCost !== null && rawCost !== undefined && rawCost !== "" && nullableNonNegativeNumber(rawCost) === null) return null;
  if (rawNextOdometer !== null && rawNextOdometer !== undefined && rawNextOdometer !== "" && nullableNonNegativeNumber(rawNextOdometer) === null) return null;

  const store = readFleetMaintenanceStore();
  const recordId = String(input.recordId || "").trim();
  const existingIndex = recordId ? store.records.findIndex((record) => record.recordId === recordId) : -1;
  const existing = existingIndex >= 0 ? store.records[existingIndex] : null;
  const now = new Date().toISOString();
  const record: FleetMaintenanceRecord = {
    recordId: existing?.recordId || recordId || randomUUID(),
    truck,
    serviceDate,
    status,
    serviceType,
    description: String(input.description || "").trim(),
    odometer: nullableNonNegativeNumber(rawOdometer),
    cost: nullableNonNegativeNumber(rawCost),
    vendor: String(input.vendor || "").trim(),
    nextServiceDate,
    nextServiceOdometer: nullableNonNegativeNumber(rawNextOdometer),
    notes: String(input.notes || "").trim(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (existingIndex >= 0) store.records.splice(existingIndex, 1, record);
  else store.records.push(record);
  writeFleetMaintenanceStore({ version: 1, updatedAt: now, records: store.records });
  return record;
}

export function deleteFleetMaintenanceRecord(recordId: string): boolean {
  const id = String(recordId || "").trim();
  if (!id) return false;
  const store = readFleetMaintenanceStore();
  const records = store.records.filter((record) => record.recordId !== id);
  if (records.length === store.records.length) return false;
  writeFleetMaintenanceStore({ version: 1, updatedAt: new Date().toISOString(), records });
  return true;
}

export function fleetMaintenanceSummary(records: FleetMaintenanceRecord[], today: string) {
  const upcomingLimit = new Date(`${today}T12:00:00`);
  upcomingLimit.setDate(upcomingLimit.getDate() + 30);
  const upcomingLimitKey = upcomingLimit.toISOString().slice(0, 10);
  const scheduled = records.filter((record) => record.status === "scheduled");
  const overdue = scheduled.filter((record) => record.serviceDate < today).length;
  const dueSoon = scheduled.filter((record) => record.serviceDate >= today && record.serviceDate <= upcomingLimitKey).length;
  const completed = records.filter((record) => record.status === "completed");
  const totalCost = completed.reduce((sum, record) => sum + (record.cost || 0), 0);
  return { overdue, dueSoon, completed: completed.length, totalCost };
}
