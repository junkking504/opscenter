import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export const RESALE_STATUSES = ["to_list", "listed", "sold"] as const;

export type ResaleStatus = (typeof RESALE_STATUSES)[number];

export type ResaleItem = {
  itemId: string;
  itemName: string;
  acquiredDate: string;
  source: string;
  cost: number;
  askingPrice: number;
  soldPrice: number;
  status: ResaleStatus;
  marketplace: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type ResaleStore = {
  version: 1;
  updatedAt: string;
  items: ResaleItem[];
};

export type ResaleItemInput = Omit<ResaleItem, "itemId" | "createdAt" | "updatedAt"> & {
  itemId?: string;
};

const STORE_FILE = "resale_items.json";

function storePath(): string {
  return path.join(process.cwd(), "data", "finance", STORE_FILE);
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function safeMoney(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? roundMoney(Math.max(0, amount)) : 0;
}

function safeStatus(value: unknown): ResaleStatus {
  return RESALE_STATUSES.includes(value as ResaleStatus) ? (value as ResaleStatus) : "to_list";
}

function safeDate(value: unknown): string {
  const date = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function normalizeItem(value: Record<string, unknown>): ResaleItem | null {
  const itemName = String(value.itemName || "").trim();
  if (!itemName) return null;

  return {
    itemId: String(value.itemId || randomUUID()).trim(),
    itemName,
    acquiredDate: safeDate(value.acquiredDate),
    source: String(value.source || "").trim(),
    cost: safeMoney(value.cost),
    askingPrice: safeMoney(value.askingPrice),
    soldPrice: safeMoney(value.soldPrice),
    status: safeStatus(value.status),
    marketplace: String(value.marketplace || "").trim(),
    notes: String(value.notes || "").trim(),
    createdAt: String(value.createdAt || ""),
    updatedAt: String(value.updatedAt || ""),
  };
}

function sortItems(items: ResaleItem[]): ResaleItem[] {
  const statusRank: Record<ResaleStatus, number> = { listed: 0, to_list: 1, sold: 2 };
  return items.slice().sort((a, b) => {
    const statusOrder = statusRank[a.status] - statusRank[b.status];
    if (statusOrder !== 0) return statusOrder;
    const updatedOrder = b.updatedAt.localeCompare(a.updatedAt);
    if (updatedOrder !== 0) return updatedOrder;
    return a.itemName.localeCompare(b.itemName);
  });
}

export function readResaleStore(): ResaleStore {
  try {
    const filePath = storePath();
    if (!fs.existsSync(filePath)) return { version: 1, updatedAt: "", items: [] };
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const items = Array.isArray(parsed?.items)
      ? parsed.items
          .map((item: Record<string, unknown>) => normalizeItem(item))
          .filter(Boolean) as ResaleItem[]
      : [];

    return {
      version: 1,
      updatedAt: String(parsed?.updatedAt || ""),
      items: sortItems(items),
    };
  } catch {
    return { version: 1, updatedAt: "", items: [] };
  }
}

function writeResaleStore(store: ResaleStore): void {
  const filePath = storePath();
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = path.join(directory, `.${STORE_FILE}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(
    temporaryFile,
    `${JSON.stringify({ ...store, items: sortItems(store.items) }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o660 },
  );
  fs.chmodSync(temporaryFile, 0o660);
  fs.renameSync(temporaryFile, filePath);
}

export function upsertResaleItem(input: ResaleItemInput): ResaleItem | null {
  const normalized = normalizeItem(input as unknown as Record<string, unknown>);
  if (!normalized) return null;

  const now = new Date().toISOString();
  const store = readResaleStore();
  const requestedId = String(input.itemId || "").trim();
  const existingIndex = requestedId
    ? store.items.findIndex((item) => item.itemId === requestedId)
    : -1;
  const existing = existingIndex >= 0 ? store.items[existingIndex] : null;
  const saved: ResaleItem = {
    ...normalized,
    itemId: existing?.itemId || requestedId || randomUUID(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (existingIndex >= 0) store.items.splice(existingIndex, 1, saved);
  else store.items.push(saved);

  writeResaleStore({ version: 1, updatedAt: now, items: store.items });
  return saved;
}

export function deleteResaleItem(itemId: string): boolean {
  const id = String(itemId || "").trim();
  if (!id) return false;

  const store = readResaleStore();
  const remaining = store.items.filter((item) => item.itemId !== id);
  if (remaining.length === store.items.length) return false;

  writeResaleStore({
    version: 1,
    updatedAt: new Date().toISOString(),
    items: remaining,
  });
  return true;
}
