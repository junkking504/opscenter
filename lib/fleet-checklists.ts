import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  FLEET_CHECKLIST_CADENCES,
  FLEET_CHECKLIST_ITEM_STATUSES,
  effectiveFleetChecklistDefinitions,
  fleetChecklistPeriodKey,
  type FleetChecklistCadence,
  type FleetChecklistCustomization,
  type FleetChecklistDefinition,
  type FleetChecklistItemStatus,
} from "@/lib/fleet-checklist-definitions";
import { readFleetChecklistTemplateStore } from "@/lib/fleet-checklist-templates";

export type FleetChecklistAnswer = {
  itemId: string;
  status: FleetChecklistItemStatus;
  notes: string;
};

export type FleetChecklistPhoto = {
  photoId: string;
  itemId: string;
  fileName: string;
  storageName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export type FleetChecklistEntry = {
  entryId: string;
  truck: string;
  cadence: FleetChecklistCadence;
  inspectionDate: string;
  periodKey: string;
  inspector: string;
  odometer: number | null;
  answers: FleetChecklistAnswer[];
  photos: FleetChecklistPhoto[];
  completedAt: string;
  submittedByEmail: string;
  createdAt: string;
  updatedAt: string;
};

export type FleetChecklistStore = {
  version: 1;
  updatedAt: string;
  entries: FleetChecklistEntry[];
};

export type FleetChecklistInput = {
  truck: string;
  cadence: string;
  inspectionDate: string;
  inspector?: string;
  odometer?: unknown;
  answers?: unknown;
  submittedByEmail?: string;
};

const STORE_FILE = "checklist_submissions.json";

export function fleetChecklistStorePath(): string {
  return path.join(process.cwd(), "data", "fleet", STORE_FILE);
}

function normalizeTruck(value: unknown): string {
  const raw = String(value || "").trim();
  const match = raw.match(/(\d+)/);
  return match ? `Truck# ${match[1]}` : raw.replace(/\s+/g, " ");
}

function validDate(value: unknown): value is string {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function cadenceValue(value: unknown): FleetChecklistCadence | null {
  return FLEET_CHECKLIST_CADENCES.includes(value as FleetChecklistCadence) ? value as FleetChecklistCadence : null;
}

function nonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function parseAnswers(value: unknown, definitions: FleetChecklistDefinition[]): FleetChecklistAnswer[] {
  if (!Array.isArray(value)) return [];
  const allowedIds = new Set(definitions.map((item) => item.itemId));
  const byId = new Map<string, FleetChecklistAnswer>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const itemId = String(row.itemId || "").trim();
    const status = String(row.status || "").trim() as FleetChecklistItemStatus;
    if (!allowedIds.has(itemId) || !FLEET_CHECKLIST_ITEM_STATUSES.includes(status)) continue;
    byId.set(itemId, { itemId, status, notes: String(row.notes || "").trim().slice(0, 500) });
  }
  return definitions.flatMap((item) => {
    const answer = byId.get(item.itemId);
    return answer ? [answer] : [];
  });
}

function parsePhotos(value: unknown, definitions: FleetChecklistDefinition[]): FleetChecklistPhoto[] {
  if (!Array.isArray(value)) return [];
  const allowedIds = new Set(definitions.map((item) => item.itemId));
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const photoId = String(row.photoId || "").trim();
    const itemId = String(row.itemId || "").trim();
    const storageName = path.basename(String(row.storageName || "").trim());
    const mimeType = String(row.mimeType || "").trim().toLowerCase();
    if (!photoId || !storageName || !allowedIds.has(itemId) || !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) return [];
    return [{
      photoId,
      itemId,
      fileName: path.basename(String(row.fileName || "photo").trim()).slice(0, 160),
      storageName,
      mimeType,
      size: Math.max(0, Number(row.size) || 0),
      uploadedAt: String(row.uploadedAt || "").trim(),
    }];
  });
}

function isComplete(definitions: FleetChecklistDefinition[], answers: FleetChecklistAnswer[], inspector: string): boolean {
  return Boolean(inspector) && definitions.length > 0 && answers.length === definitions.length;
}

function sortEntries(entries: FleetChecklistEntry[]): FleetChecklistEntry[] {
  return entries.slice().sort((a, b) =>
    b.inspectionDate.localeCompare(a.inspectionDate)
      || a.truck.localeCompare(b.truck, undefined, { numeric: true })
      || b.updatedAt.localeCompare(a.updatedAt)
  );
}

function parseEntry(value: Record<string, unknown>, customizations: FleetChecklistCustomization[]): FleetChecklistEntry | null {
  const truck = normalizeTruck(value.truck);
  const cadence = cadenceValue(value.cadence);
  const inspectionDate = String(value.inspectionDate || "").trim();
  if (!truck || !cadence || !validDate(inspectionDate)) return null;
  const inspector = String(value.inspector || "").trim().slice(0, 100);
  const definitions = effectiveFleetChecklistDefinitions(truck, cadence, customizations);
  const answers = parseAnswers(value.answers, definitions);
  return {
    entryId: String(value.entryId || randomUUID()).trim(),
    truck,
    cadence,
    inspectionDate,
    periodKey: fleetChecklistPeriodKey(inspectionDate, cadence),
    inspector,
    odometer: nonNegativeNumber(value.odometer),
    answers,
    photos: parsePhotos(value.photos, definitions),
    completedAt: isComplete(definitions, answers, inspector) ? String(value.completedAt || "").trim() : "",
    submittedByEmail: String(value.submittedByEmail || "").trim().toLowerCase(),
    createdAt: String(value.createdAt || "").trim(),
    updatedAt: String(value.updatedAt || "").trim(),
  };
}

export function readFleetChecklistStore(): FleetChecklistStore {
  try {
    const filePath = fleetChecklistStorePath();
    if (!fs.existsSync(filePath)) return { version: 1, updatedAt: "", entries: [] };
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const customizations = readFleetChecklistTemplateStore().customizations;
    const entries = (Array.isArray(payload?.entries) ? payload.entries : [])
      .map((entry: unknown) => entry && typeof entry === "object" ? parseEntry(entry as Record<string, unknown>, customizations) : null)
      .filter(Boolean) as FleetChecklistEntry[];
    return { version: 1, updatedAt: String(payload?.updatedAt || ""), entries: sortEntries(entries) };
  } catch {
    return { version: 1, updatedAt: "", entries: [] };
  }
}

function writeFleetChecklistStore(store: FleetChecklistStore): void {
  const filePath = fleetChecklistStorePath();
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = path.join(directory, `.${STORE_FILE}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporaryFile, JSON.stringify({
    version: 1,
    updatedAt: store.updatedAt,
    entries: sortEntries(store.entries),
  }, null, 2), { encoding: "utf8", mode: 0o660 });
  fs.chmodSync(temporaryFile, 0o660);
  fs.renameSync(temporaryFile, filePath);
}

export function upsertFleetChecklist(input: FleetChecklistInput): FleetChecklistEntry | null {
  const truck = normalizeTruck(input.truck);
  const cadence = cadenceValue(input.cadence);
  const inspectionDate = String(input.inspectionDate || "").trim();
  const inspector = String(input.inspector || "").trim().slice(0, 100);
  if (!truck || !cadence || !validDate(inspectionDate)) return null;
  if (input.odometer !== null && input.odometer !== undefined && input.odometer !== "" && nonNegativeNumber(input.odometer) === null) return null;

  const definitions = effectiveFleetChecklistDefinitions(truck, cadence, readFleetChecklistTemplateStore().customizations);
  const answers = parseAnswers(input.answers, definitions);
  const periodKey = fleetChecklistPeriodKey(inspectionDate, cadence);
  const store = readFleetChecklistStore();
  const existingIndex = store.entries.findIndex((entry) =>
    entry.truck === truck && entry.cadence === cadence && entry.periodKey === periodKey
  );
  const existing = existingIndex >= 0 ? store.entries[existingIndex] : null;
  const now = new Date().toISOString();
  const complete = isComplete(definitions, answers, inspector);
  const entry: FleetChecklistEntry = {
    entryId: existing?.entryId || randomUUID(),
    truck,
    cadence,
    inspectionDate,
    periodKey,
    inspector,
    odometer: nonNegativeNumber(input.odometer),
    answers,
    photos: existing?.photos || [],
    completedAt: complete ? existing?.completedAt || now : "",
    submittedByEmail: String(input.submittedByEmail || existing?.submittedByEmail || "").trim().toLowerCase(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (existingIndex >= 0) store.entries.splice(existingIndex, 1, entry);
  else store.entries.push(entry);
  writeFleetChecklistStore({ version: 1, updatedAt: now, entries: store.entries });
  return entry;
}

export function fleetChecklistPhotoDirectory(): string {
  return path.join(process.cwd(), "data", "fleet", "checklist_photos");
}

export function fleetChecklistPhotoFilePath(photo: FleetChecklistPhoto): string {
  return path.join(fleetChecklistPhotoDirectory(), path.basename(photo.storageName));
}

export function attachFleetChecklistPhoto(entryId: string, input: Omit<FleetChecklistPhoto, "photoId" | "uploadedAt">): FleetChecklistPhoto | null {
  const store = readFleetChecklistStore();
  const entryIndex = store.entries.findIndex((entry) => entry.entryId === String(entryId || "").trim());
  if (entryIndex < 0) return null;
  const entry = store.entries[entryIndex];
  const allowedIds = new Set(effectiveFleetChecklistDefinitions(entry.truck, entry.cadence, readFleetChecklistTemplateStore().customizations).map((item) => item.itemId));
  if (!allowedIds.has(input.itemId)) return null;
  const now = new Date().toISOString();
  const photo: FleetChecklistPhoto = {
    photoId: randomUUID(),
    itemId: input.itemId,
    fileName: path.basename(input.fileName).slice(0, 160),
    storageName: path.basename(input.storageName),
    mimeType: input.mimeType,
    size: Math.max(0, input.size),
    uploadedAt: now,
  };
  entry.photos.push(photo);
  entry.updatedAt = now;
  store.entries.splice(entryIndex, 1, entry);
  writeFleetChecklistStore({ version: 1, updatedAt: now, entries: store.entries });
  return photo;
}

export function findFleetChecklistPhoto(photoId: string): { entry: FleetChecklistEntry; photo: FleetChecklistPhoto } | null {
  for (const entry of readFleetChecklistStore().entries) {
    const photo = entry.photos.find((candidate) => candidate.photoId === photoId);
    if (photo) return { entry, photo };
  }
  return null;
}

export function detachFleetChecklistPhoto(photoId: string): FleetChecklistPhoto | null {
  const store = readFleetChecklistStore();
  for (let index = 0; index < store.entries.length; index += 1) {
    const entry = store.entries[index];
    const photoIndex = entry.photos.findIndex((photo) => photo.photoId === photoId);
    if (photoIndex < 0) continue;
    const [photo] = entry.photos.splice(photoIndex, 1);
    const now = new Date().toISOString();
    entry.updatedAt = now;
    store.entries.splice(index, 1, entry);
    writeFleetChecklistStore({ version: 1, updatedAt: now, entries: store.entries });
    return photo;
  }
  return null;
}
