import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export const RESALE_STATUSES = ["to_list", "listed", "sold"] as const;

export type ResaleStatus = (typeof RESALE_STATUSES)[number];

export type ResaleItem = {
  itemId: string;
  itemNumber?: string;
  photos?: ResalePhoto[];
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

export type ResalePhoto = { photoId: string; mimeType: string; receivedAt: string };
export type ResaleReceipt = { status: "saved" | "sold" | "review"; itemId?: string; reply: string };

export type ResaleStore = {
  nextItemNumber?: number;
  messages?: Record<string, ResaleReceipt>;
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
    itemNumber: /^RS-\d{4,}$/.test(String(value.itemNumber)) ? String(value.itemNumber) : undefined,
    photos: Array.isArray(value.photos) ? value.photos.filter((photo): photo is ResalePhoto => Boolean(photo && /^[a-f0-9]{64}$/.test(photo.photoId) && ["image/jpeg", "image/png"].includes(photo.mimeType))) : [],
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

function readRawResaleStore(): ResaleStore {
  try {
    const filePath = storePath();
    if (!fs.existsSync(filePath)) return { version: 1, updatedAt: "", items: [] };
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed?.version !== 1 || !Array.isArray(parsed.items)) throw new Error("Resale inventory requires recovery.");
    const items = Array.isArray(parsed?.items)
      ? parsed.items
          .map((item: Record<string, unknown>) => normalizeItem(item))
          .filter(Boolean) as ResaleItem[]
      : [];

    if (items.length !== parsed.items.length) throw new Error("Resale inventory contains an invalid item and requires recovery.");
    return {
      version: 1,
      nextItemNumber: Number(parsed.nextItemNumber) || 1,
      messages: parsed.messages || {},
      updatedAt: String(parsed?.updatedAt || ""),
      items: sortItems(items),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, updatedAt: "", items: [] };
    throw error;
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

// All web and worker mutations share this lock and one atomic snapshot.
export function mutateResaleStore<T>(change: (store: ResaleStore) => T): T {
  const lock = `${storePath()}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  let descriptor: number | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { descriptor = fs.openSync(lock, "wx", 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (descriptor === undefined) throw new Error("Resale inventory is busy or requires lock recovery. Try again.");
  try {
    const store = readRawResaleStore();
    const before = JSON.stringify(store);
    store.nextItemNumber = Math.max(store.nextItemNumber || 1, ...store.items.map(item => Number(item.itemNumber?.slice(3) || 0) + 1));
    const seen = new Set<string>();
    for (const item of store.items) {
      if (!item.itemNumber || seen.has(item.itemNumber)) item.itemNumber = allocateResaleNumber(store);
      seen.add(item.itemNumber);
    }
    store.messages ||= {};
    const result = change(store);
    if (JSON.stringify(store) !== before) {
      store.updatedAt = new Date().toISOString();
      writeResaleStore(store);
    }
    return result;
  } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
}

export function allocateResaleNumber(store: ResaleStore): string {
  const number = store.nextItemNumber || 1;
  store.nextItemNumber = number + 1;
  return `RS-${String(number).padStart(4, "0")}`;
}

export function readResaleStore(): ResaleStore {
  return mutateResaleStore(store => store);
}

export function upsertResaleItem(input: ResaleItemInput): ResaleItem | null {
  const normalized = normalizeItem(input as unknown as Record<string, unknown>);
  if (!normalized) return null;
  return mutateResaleStore(store => {
    const now = new Date().toISOString();
    const existing = store.items.find(item => item.itemId === input.itemId);
    const saved: ResaleItem = {
      ...normalized,
      itemId: existing?.itemId || input.itemId || randomUUID(),
      itemNumber: existing?.itemNumber || allocateResaleNumber(store),
      photos: existing?.photos || [],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    store.items = store.items.filter(item => item.itemId !== saved.itemId).concat(saved);
    return saved;
  });
}

export function deleteResaleItem(itemId: string): boolean {
  return mutateResaleStore(store => {
    const before = store.items.length;
    store.items = store.items.filter(item => item.itemId !== itemId);
    return store.items.length !== before;
  });
}
