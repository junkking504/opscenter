import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const TRUCK_STARTING_LOAD_OPTIONS = [
  { value: 0, label: "Empty" },
  { value: 1 / 12, label: "Minimum / 1/12" },
  { value: 1 / 8, label: "1/8 full" },
  { value: 1 / 6, label: "1/6 full" },
  { value: 1 / 4, label: "1/4 full" },
  { value: 1 / 3, label: "1/3 full" },
  { value: 3 / 8, label: "3/8 full" },
  { value: 1 / 2, label: "1/2 full" },
  { value: 5 / 8, label: "5/8 full" },
  { value: 2 / 3, label: "2/3 full" },
  { value: 3 / 4, label: "3/4 full" },
  { value: 7 / 8, label: "7/8 full" },
  { value: 1, label: "Full truck" },
] as const;

export type TruckLoadResetLocation = "dump" | "metal_yard";
export type TruckLoadEventKind = "day_start" | "job_closeout" | "manual_snapshot" | "yard_reset";

export type TruckLoadEvent = {
  eventId: string;
  date: string;
  truck: string;
  kind: TruckLoadEventKind;
  loadFraction: number;
  occurredAt: string;
  recordedAt: string;
  recordedBy: string;
  appointmentId: string;
  jobNumber: string;
  loadSize: string;
  loadQuantity: string;
  contents: string;
  resetLocation: TruckLoadResetLocation | "";
};

export type TruckLoadStatus = {
  date: string;
  truck: string;
  startingLoadFraction: number;
  currentLoadFraction: number;
  currentLoadLabel: string;
  currentContents: string;
  capacityPercent: number;
  isOverCapacity: boolean;
  lastEvent: TruckLoadEvent | null;
  events: TruckLoadEvent[];
};

type TruckLoadStore = {
  version: 1;
  updatedAt: string;
  events: TruckLoadEvent[];
};

const STORE_FILE = "truck_load_status.json";

function dataRoot(): string {
  return String(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || "").trim()
    || path.join(process.cwd(), "data");
}

export function truckLoadStatusStorePath(): string {
  return path.join(dataRoot(), "fleet", STORE_FILE);
}

export function normalizeTruckLoadLabel(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw || /virtual|unassigned|unavailable|^—$/i.test(raw)) return "";
  const match = raw.match(/(?:truck\s*#?\s*)?(\d+)/i);
  return match ? `Truck# ${match[1]}` : raw.replace(/\s+/g, " ");
}

function validDate(value: unknown): value is string {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function cleanFraction(value: unknown, maximum = 100): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > maximum) return null;
  return number;
}

function cleanEvent(value: unknown): TruckLoadEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const date = String(row.date || "").trim();
  const truck = normalizeTruckLoadLabel(row.truck);
  const kind = String(row.kind || "") as TruckLoadEventKind;
  const loadFraction = cleanFraction(row.loadFraction);
  if (!validDate(date) || !truck || !["day_start", "job_closeout", "manual_snapshot", "yard_reset"].includes(kind) || loadFraction === null) return null;
  const resetLocation = String(row.resetLocation || "");
  return {
    eventId: String(row.eventId || randomUUID()).trim(),
    date,
    truck,
    kind,
    loadFraction,
    occurredAt: String(row.occurredAt || "").trim(),
    recordedAt: String(row.recordedAt || "").trim(),
    recordedBy: String(row.recordedBy || "").trim().slice(0, 160),
    appointmentId: String(row.appointmentId || "").trim(),
    jobNumber: String(row.jobNumber || "").trim().slice(0, 40),
    loadSize: String(row.loadSize || "").trim().slice(0, 80),
    loadQuantity: String(row.loadQuantity || "").trim().slice(0, 20),
    contents: String(row.contents || "").replace(/\s+/g, " ").trim().slice(0, 500),
    resetLocation: resetLocation === "dump" || resetLocation === "metal_yard" ? resetLocation : "",
  };
}

function eventOrder(a: TruckLoadEvent, b: TruckLoadEvent): number {
  if (a.kind === "day_start" && b.kind !== "day_start") return -1;
  if (b.kind === "day_start" && a.kind !== "day_start") return 1;
  return a.occurredAt.localeCompare(b.occurredAt) || a.recordedAt.localeCompare(b.recordedAt) || a.eventId.localeCompare(b.eventId);
}

export function readTruckLoadStore(): TruckLoadStore {
  try {
    const filePath = truckLoadStatusStorePath();
    if (!fs.existsSync(filePath)) return { version: 1, updatedAt: "", events: [] };
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const events = (Array.isArray(payload?.events) ? payload.events : [])
      .map(cleanEvent)
      .filter((event: TruckLoadEvent | null): event is TruckLoadEvent => Boolean(event))
      .sort(eventOrder);
    return { version: 1, updatedAt: String(payload?.updatedAt || ""), events };
  } catch {
    return { version: 1, updatedAt: "", events: [] };
  }
}

function writeTruckLoadStore(store: TruckLoadStore): void {
  const filePath = truckLoadStatusStorePath();
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = path.join(directory, `.${STORE_FILE}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporaryFile, `${JSON.stringify({ ...store, events: store.events.slice().sort(eventOrder) }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o660,
  });
  fs.chmodSync(temporaryFile, 0o660);
  fs.renameSync(temporaryFile, filePath);
}

function withTruckLoadStoreLock<T>(callback: () => T): T {
  const filePath = truckLoadStatusStorePath();
  const directory = path.dirname(filePath);
  const lockPath = `${filePath}.lock`;
  fs.mkdirSync(directory, { recursive: true });
  let descriptor: number | null = null;
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      descriptor = fs.openSync(lockPath, "wx", 0o660);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 30_000) fs.unlinkSync(lockPath);
      } catch {}
      Atomics.wait(waitBuffer, 0, 0, 20);
    }
  }
  if (descriptor === null) throw new Error("The truck load status is busy. Try the update again.");
  try {
    return callback();
  } finally {
    fs.closeSync(descriptor);
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right) [left, right] = [right, left % right];
  return left || 1;
}

function nearestFraction(value: number): string {
  const denominator = 24;
  const numerator = Math.round(value * denominator);
  if (numerator <= 0) return "0";
  const divisor = greatestCommonDivisor(numerator, denominator);
  return `${numerator / divisor}/${denominator / divisor}`;
}

export function formatTruckLoadFraction(value: number): string {
  const load = Math.max(0, Number(value) || 0);
  if (load < 1 / 48) return "Empty";
  if (Math.abs(load - 1) < 1 / 48) return "Full truck";
  if (load > 1) {
    const fullTrucks = Math.floor(load + 1 / 48);
    const remainder = load - fullTrucks;
    if (Math.abs(remainder) < 1 / 48) return `${fullTrucks} full trucks`;
    return `${fullTrucks === 1 ? "Full" : `${fullTrucks} full`} + ${nearestFraction(remainder)}`;
  }
  return `${nearestFraction(load)} full`;
}

export function parseJunkwareLoadFraction(value: unknown): number | null {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/\bfull(?:\s+truck)?\b/i.test(text)) return 1;
  if (/\bminimum\b/i.test(text)) return 1 / 12;
  if (/\b(?:empty|none)\b/i.test(text)) return 0;

  const parenthetical = text.match(/\(\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*\)/);
  const fraction = parenthetical || text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?:\s|$)/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) return cleanFraction(numerator / denominator, 1);
  }

  const junkwareUnits = Number(text.match(/^\s*(\d+(?:\.\d+)?)/)?.[1]);
  if (Number.isFinite(junkwareUnits) && junkwareUnits >= 0 && junkwareUnits <= 6) return cleanFraction(junkwareUnits / 6, 1);
  return null;
}

export function junkwareJobLoadFraction(loadSize: unknown, loadQuantity: unknown): number | null {
  const perTruck = parseJunkwareLoadFraction(loadSize);
  if (perTruck === null) return null;
  const quantityText = String(loadQuantity ?? "").trim();
  const parsedQuantity = quantityText ? Number(quantityText) : 1;
  if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0 || parsedQuantity > 100) return null;
  return cleanFraction(perTruck * parsedQuantity);
}

export function deriveTruckLoadStatus(date: string, truck: string, sourceEvents: TruckLoadEvent[]): TruckLoadStatus {
  const normalizedTruck = normalizeTruckLoadLabel(truck);
  const events = sourceEvents
    .filter((event) => event.date === date && event.truck === normalizedTruck)
    .slice()
    .sort(eventOrder);
  const startingEvent = events.filter((event) => event.kind === "day_start").at(-1) || null;
  let currentLoadFraction = startingEvent?.loadFraction || 0;
  let currentContents = startingEvent?.contents || "";
  for (const event of events) {
    if (event.kind === "day_start") continue;
    if (event.kind === "yard_reset") {
      currentLoadFraction = 0;
      currentContents = "";
    } else if (event.kind === "manual_snapshot") {
      currentLoadFraction = event.loadFraction;
      currentContents = event.contents;
    } else {
      currentLoadFraction += event.loadFraction;
      if (event.loadFraction > 0 && !currentContents) currentContents = "Contents not recorded";
      else if (event.loadFraction > 0 && !/additional job contents not recorded/i.test(currentContents)) {
        currentContents = `${currentContents}; additional job contents not recorded`;
      }
    }
  }
  const chronological = events.filter((event) => event.kind !== "day_start");
  return {
    date,
    truck: normalizedTruck,
    startingLoadFraction: startingEvent?.loadFraction || 0,
    currentLoadFraction,
    currentLoadLabel: formatTruckLoadFraction(currentLoadFraction),
    currentContents,
    capacityPercent: Math.round(currentLoadFraction * 100),
    isOverCapacity: currentLoadFraction > 1 + 1 / 48,
    lastEvent: chronological.at(-1) || startingEvent,
    events: events.slice().reverse(),
  };
}

export function readTruckLoadStatuses(date: string, trucks: string[] = []): TruckLoadStatus[] {
  if (!validDate(date)) return [];
  const store = readTruckLoadStore();
  const normalizedTrucks = Array.from(new Set([
    ...trucks.map(normalizeTruckLoadLabel),
    ...store.events.filter((event) => event.date === date).map((event) => event.truck),
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return normalizedTrucks.map((truck) => deriveTruckLoadStatus(date, truck, store.events));
}

export function setTruckStartingLoad(input: {
  date: string;
  truck: string;
  loadFraction: unknown;
  recordedBy: string;
  expectedStoreUpdatedAt?: string;
}): TruckLoadStatus {
  const truck = normalizeTruckLoadLabel(input.truck);
  const loadFraction = cleanFraction(input.loadFraction, 1);
  if (!validDate(input.date) || !truck || loadFraction === null) throw new Error("Choose a valid truck, date, and starting load.");
  return withTruckLoadStoreLock(() => {
    const store = readTruckLoadStore();
    if (input.expectedStoreUpdatedAt !== undefined && store.updatedAt !== input.expectedStoreUpdatedAt) {
      throw new Error("VERSION_CONFLICT: Truck load state changed after this request was prepared.");
    }
    const now = new Date().toISOString();
    const eventId = `day-start:${input.date}:${truck.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const existing = store.events.find((event) => event.eventId === eventId);
    const event: TruckLoadEvent = {
      eventId,
      date: input.date,
      truck,
      kind: "day_start",
      loadFraction,
      occurredAt: existing?.occurredAt || `${input.date}T00:00:00`,
      recordedAt: now,
      recordedBy: String(input.recordedBy || "").trim().slice(0, 160),
      appointmentId: "",
      jobNumber: "",
      loadSize: formatTruckLoadFraction(loadFraction),
      loadQuantity: "",
      contents: "",
      resetLocation: "",
    };
    const events = store.events.filter((candidate) => candidate.eventId !== eventId);
    events.push(event);
    writeTruckLoadStore({ version: 1, updatedAt: now, events });
    return deriveTruckLoadStatus(input.date, truck, events);
  });
}

export function resetTruckLoad(input: {
  date: string;
  truck: string;
  location: TruckLoadResetLocation;
  recordedBy: string;
  occurredAt?: string;
  eventId?: string;
  expectedStoreUpdatedAt?: string;
}): TruckLoadStatus {
  const truck = normalizeTruckLoadLabel(input.truck);
  if (!validDate(input.date) || !truck || !["dump", "metal_yard"].includes(input.location)) {
    throw new Error("Choose a valid truck and dump or metal-yard reset.");
  }
  return withTruckLoadStoreLock(() => {
    const store = readTruckLoadStore();
    const now = new Date().toISOString();
    const suppliedEventId = String(input.eventId || "").replace(/[^a-zA-Z0-9:_-]+/g, "-").slice(0, 180);
    const eventId = suppliedEventId ? `yard-reset:${suppliedEventId}` : randomUUID();
    const existing = store.events.find((candidate) => candidate.eventId === eventId);
    if (existing) return deriveTruckLoadStatus(input.date, existing.truck, store.events);
    if (input.expectedStoreUpdatedAt !== undefined && store.updatedAt !== input.expectedStoreUpdatedAt) {
      throw new Error("VERSION_CONFLICT: Truck load state changed after this request was prepared.");
    }
    const latestTruckEvent = store.events
      .filter((candidate) => candidate.date === input.date && candidate.truck === truck && candidate.kind !== "day_start")
      .slice()
      .sort(eventOrder)
      .at(-1);
    const requestedOccurredAt = String(input.occurredAt || now);
    const occurredAt = input.occurredAt || !latestTruckEvent || requestedOccurredAt > latestTruckEvent.occurredAt
      ? requestedOccurredAt
      : new Date(new Date(latestTruckEvent.occurredAt).getTime() + 1).toISOString();
    const event: TruckLoadEvent = {
      eventId,
      date: input.date,
      truck,
      kind: "yard_reset",
      loadFraction: 0,
      occurredAt,
      recordedAt: now,
      recordedBy: String(input.recordedBy || "").trim().slice(0, 160),
      appointmentId: "",
      jobNumber: "",
      loadSize: "",
      loadQuantity: "",
      contents: "",
      resetLocation: input.location,
    };
    const events = [...store.events, event];
    writeTruckLoadStore({ version: 1, updatedAt: now, events });
    return deriveTruckLoadStatus(input.date, truck, events);
  });
}

export function recordTruckLoadFromCloseout(input: {
  date: string;
  truck: string;
  appointmentId: string;
  jobNumber?: string;
  loadSize: unknown;
  loadQuantity: unknown;
  verifiedAt?: string;
  recordedBy?: string;
}): { updated: boolean; status: TruckLoadStatus | null; reason: string } {
  const truck = normalizeTruckLoadLabel(input.truck);
  const appointmentId = String(input.appointmentId || "").trim();
  if (!validDate(input.date) || !truck || !/^\d{1,12}$/.test(appointmentId)) {
    return { updated: false, status: null, reason: "The closeout does not have a dated physical truck assignment." };
  }
  const loadSize = String(input.loadSize || "").trim();
  const loadFraction = junkwareJobLoadFraction(loadSize, input.loadQuantity);
  if (loadFraction === null) {
    return { updated: false, status: null, reason: "The JunkWare closeout did not contain a recognized load size." };
  }

  return withTruckLoadStoreLock(() => {
    const store = readTruckLoadStore();
    const now = new Date().toISOString();
    const eventId = `job-closeout:${appointmentId}`;
    const existing = store.events.find((event) => event.eventId === eventId);
    const event: TruckLoadEvent = {
      eventId,
      date: input.date,
      truck,
      kind: "job_closeout",
      loadFraction,
      occurredAt: existing?.occurredAt || String(input.verifiedAt || now),
      recordedAt: now,
      recordedBy: String(input.recordedBy || "JunkWare closeout").trim().slice(0, 160),
      appointmentId,
      jobNumber: String(input.jobNumber || "").trim().slice(0, 40),
      loadSize,
      loadQuantity: String(input.loadQuantity ?? "").trim().slice(0, 20),
      contents: "",
      resetLocation: "",
    };
    const events = store.events.filter((candidate) => candidate.eventId !== eventId);
    events.push(event);
    writeTruckLoadStore({ version: 1, updatedAt: now, events });
    return { updated: true, status: deriveTruckLoadStatus(input.date, truck, events), reason: "" };
  });
}

export function recordTruckLoadSnapshot(input: {
  date: string;
  truck: string;
  loadFraction: unknown;
  contents: string;
  messageId: string;
  occurredAt?: string;
  recordedBy?: string;
}): { created: boolean; status: TruckLoadStatus } {
  const truck = normalizeTruckLoadLabel(input.truck);
  const loadFraction = cleanFraction(input.loadFraction, 2);
  const messageId = String(input.messageId || "").trim();
  const contents = String(input.contents || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!validDate(input.date) || !truck || loadFraction === null || !messageId || (loadFraction > 0 && !contents)) {
    throw new Error("Truck, load size, and contents are required for a load snapshot.");
  }
  return withTruckLoadStoreLock(() => {
    const store = readTruckLoadStore();
    const eventId = `opsbot-snapshot:${messageId}`;
    const existing = store.events.find((event) => event.eventId === eventId);
    if (existing) return { created: false, status: deriveTruckLoadStatus(input.date, existing.truck, store.events) };
    const now = new Date().toISOString();
    const event: TruckLoadEvent = {
      eventId,
      date: input.date,
      truck,
      kind: "manual_snapshot",
      loadFraction,
      occurredAt: String(input.occurredAt || now),
      recordedAt: now,
      recordedBy: String(input.recordedBy || "OpsBot").trim().slice(0, 160),
      appointmentId: "",
      jobNumber: "",
      loadSize: formatTruckLoadFraction(loadFraction),
      loadQuantity: "",
      contents,
      resetLocation: "",
    };
    const events = [...store.events, event];
    writeTruckLoadStore({ version: 1, updatedAt: now, events });
    return { created: true, status: deriveTruckLoadStatus(input.date, truck, events) };
  });
}

export function truckLoadEventLabel(event: TruckLoadEvent | null): string {
  if (!event) return "No load activity recorded";
  if (event.kind === "day_start") return `Started at ${formatTruckLoadFraction(event.loadFraction)}`;
  if (event.kind === "yard_reset") return event.resetLocation === "metal_yard" ? "Reset at metal yard" : "Reset at dump";
  if (event.kind === "manual_snapshot") return `OpsBot snapshot: ${formatTruckLoadFraction(event.loadFraction)}`;
  const job = event.jobNumber || (event.appointmentId ? `appointment ${event.appointmentId}` : "job closeout");
  return `${job} added ${formatTruckLoadFraction(event.loadFraction)}`;
}
