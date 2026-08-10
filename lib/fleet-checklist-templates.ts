import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  FLEET_CHECKLIST_CADENCES,
  FLEET_CHECKLIST_DEFINITIONS,
  type FleetChecklistCadence,
  type FleetChecklistCustomization,
  type FleetChecklistDefinition,
} from "@/lib/fleet-checklist-definitions";

export type FleetChecklistTemplateStore = {
  version: 1;
  updatedAt: string;
  customizations: FleetChecklistCustomization[];
};

const STORE_FILE = "checklist_templates.json";

function storePath(): string {
  return path.join(process.cwd(), "data", "fleet", STORE_FILE);
}

function normalizeTruck(value: unknown): string {
  const raw = String(value || "").trim();
  const match = raw.match(/(\d+)/);
  return match ? `Truck# ${match[1]}` : raw.replace(/\s+/g, " ");
}

function cadenceValue(value: unknown): FleetChecklistCadence | null {
  return FLEET_CHECKLIST_CADENCES.includes(value as FleetChecklistCadence) ? value as FleetChecklistCadence : null;
}

function parseCustomItem(value: unknown): FleetChecklistDefinition | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const label = String(row.label || "").trim().slice(0, 120);
  if (!label) return null;
  return {
    itemId: String(row.itemId || `custom-${randomUUID()}`).trim(),
    category: String(row.category || "Truck specific").trim().slice(0, 60),
    label,
    guidance: String(row.guidance || "").trim().slice(0, 300),
  };
}

function parseCustomization(value: unknown): FleetChecklistCustomization | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const truck = normalizeTruck(row.truck);
  const cadence = cadenceValue(row.cadence);
  if (!truck || !cadence) return null;
  const standardIds = new Set(FLEET_CHECKLIST_DEFINITIONS[cadence].map((item) => item.itemId));
  const hiddenItemIds = Array.isArray(row.hiddenItemIds)
    ? Array.from(new Set(row.hiddenItemIds.map(String).filter((id) => standardIds.has(id))))
    : [];
  const customItems = (Array.isArray(row.customItems) ? row.customItems : [])
    .map(parseCustomItem)
    .filter(Boolean) as FleetChecklistDefinition[];
  return { truck, cadence, hiddenItemIds, customItems, updatedAt: String(row.updatedAt || "") };
}

export function readFleetChecklistTemplateStore(): FleetChecklistTemplateStore {
  try {
    const filePath = storePath();
    if (!fs.existsSync(filePath)) return { version: 1, updatedAt: "", customizations: [] };
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const customizations = (Array.isArray(payload?.customizations) ? payload.customizations : [])
      .map(parseCustomization)
      .filter(Boolean) as FleetChecklistCustomization[];
    return { version: 1, updatedAt: String(payload?.updatedAt || ""), customizations };
  } catch {
    return { version: 1, updatedAt: "", customizations: [] };
  }
}

function writeStore(store: FleetChecklistTemplateStore): void {
  const filePath = storePath();
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = path.join(directory, `.${STORE_FILE}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o660 });
  fs.chmodSync(temporaryFile, 0o660);
  fs.renameSync(temporaryFile, filePath);
}

export function upsertFleetChecklistCustomization(input: {
  truck: string;
  cadence: string;
  hiddenItemIds?: unknown;
  customItems?: unknown;
}): FleetChecklistCustomization | null {
  const truck = normalizeTruck(input.truck);
  const cadence = cadenceValue(input.cadence);
  if (!truck || !cadence) return null;
  const parsed = parseCustomization({ ...input, truck, cadence, updatedAt: new Date().toISOString() });
  if (!parsed || parsed.customItems.length > 30) return null;
  const store = readFleetChecklistTemplateStore();
  const index = store.customizations.findIndex((row) => row.truck === truck && row.cadence === cadence);
  if (index >= 0) store.customizations.splice(index, 1, parsed);
  else store.customizations.push(parsed);
  const now = new Date().toISOString();
  writeStore({ version: 1, updatedAt: now, customizations: store.customizations });
  return parsed;
}
