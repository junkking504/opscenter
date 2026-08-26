import fs from "node:fs";
import path from "node:path";
import type { AnyRecord } from "@/lib/opsData";

const REQUIRED_MARKETS = [
  "Junk King New Orleans",
  "Junk King Northshore",
  "Junk King Baton Rouge",
  "Junk King Jefferson Parish",
] as const;
const MARKET_SCOPES = [
  ["352", "Junk King New Orleans"],
  ["477", "Junk King Northshore"],
  ["399", "Junk King Baton Rouge"],
  ["484", "Junk King Jefferson Parish"],
] as const;

export type VerifiedJunkwareScheduleSnapshot = {
  date: string;
  scrapedAt: string;
  updatedAt: string;
  updatedAtMs: number;
  freshnessAtMs: number;
  appointments: AnyRecord[];
  cancelled: AnyRecord[];
};

function recordRows(value: unknown): AnyRecord[] {
  return Array.isArray(value)
    ? value.filter((row): row is AnyRecord => Boolean(row) && typeof row === "object")
    : [];
}

function verifiedMarkets(payload: AnyRecord): Set<string> {
  const direct = Array.isArray(payload?.markets_scraped)
    ? payload.markets_scraped.map(String)
    : [];
  const territoryRows = Array.isArray(payload?.territory_verification)
    ? payload.territory_verification
    : [];
  const verified = territoryRows
    .filter((row: AnyRecord) => Boolean(row?.verified))
    .map((row: AnyRecord) => String(row?.territory || ""));
  return new Set([...direct, ...verified].map((value) => value.trim()).filter(Boolean));
}

export function junkwareScheduleSnapshotFile(dataDir: string, date: string): string {
  return path.join(dataDir, "history", "junkware", `junkware_schedule_fast_${date}.json`);
}

export function readVerifiedJunkwareScheduleSnapshot(
  dataDir: string,
  date: string,
): VerifiedJunkwareScheduleSnapshot | null {
  const aggregate = readVerifiedSnapshotFile(
    junkwareScheduleSnapshotFile(dataDir, date),
    date,
    [...REQUIRED_MARKETS],
  );
  const scoped = MARKET_SCOPES.map(([marketId, market]) => readVerifiedSnapshotFile(
    path.join(
      dataDir,
      "history",
      "junkware",
      "schedule-watchers",
      marketId,
      `junkware_schedule_fast_${date}.json`,
    ),
    date,
    [market],
  ));
  const scopedComplete = scoped.every((snapshot): snapshot is VerifiedJunkwareScheduleSnapshot => Boolean(snapshot));
  const scopedCombined = scopedComplete
    ? {
        date,
        scrapedAt: scoped.map((snapshot) => snapshot.scrapedAt).sort().at(-1) || "",
        updatedAt: new Date(Math.max(...scoped.map((snapshot) => snapshot.updatedAtMs))).toISOString(),
        updatedAtMs: Math.max(...scoped.map((snapshot) => snapshot.updatedAtMs)),
        freshnessAtMs: Math.min(...scoped.map((snapshot) => snapshot.freshnessAtMs)),
        appointments: scoped.flatMap((snapshot) => snapshot.appointments),
        cancelled: scoped.flatMap((snapshot) => snapshot.cancelled),
      }
    : null;
  if (!aggregate) return scopedCombined;
  if (!scopedCombined) return aggregate;
  return scopedCombined.updatedAtMs > aggregate.updatedAtMs ? scopedCombined : aggregate;
}

export function readVerifiedJunkwareReconciliationSnapshot(
  dataDir: string,
  date: string,
): VerifiedJunkwareScheduleSnapshot | null {
  return readVerifiedSnapshotFile(
    path.join(dataDir, "history", "junkware", `junkware_${date}_raw.json`),
    date,
    [...REQUIRED_MARKETS],
  );
}

function readVerifiedSnapshotFile(
  file: string,
  date: string,
  requiredMarkets: string[],
): VerifiedJunkwareScheduleSnapshot | null {
  try {
    const stats = fs.statSync(file);
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as AnyRecord;
    if (String(payload?.date || "") !== date) return null;
    const markets = verifiedMarkets(payload);
    if (!requiredMarkets.every((market) => markets.has(market))) return null;
    const scrapedAt = String(payload?.scraped_at || payload?.scrapedAt || "");
    const scrapedAtMs = Date.parse(scrapedAt);
    if (!Number.isFinite(scrapedAtMs)) return null;
    return {
      date,
      scrapedAt,
      updatedAt: stats.mtime.toISOString(),
      updatedAtMs: stats.mtimeMs,
      freshnessAtMs: stats.mtimeMs,
      appointments: recordRows(payload?.appointments),
      cancelled: recordRows(payload?.cancelled),
    };
  } catch {
    return null;
  }
}

export function canonicalJunkwareUpdatedAtMs(dataDir: string, date: string): number {
  const directory = path.join(dataDir, "history", "junkware");
  const files = [
    `junkware_${date}_raw.json`,
    `junkware_live_${date}_summary.csv`,
    `junkware_completed_${date}_summary.csv`,
  ];
  return files.reduce((latest, name) => {
    try {
      return Math.max(latest, fs.statSync(path.join(directory, name)).mtimeMs);
    } catch {
      return latest;
    }
  }, 0);
}

export function currentJunkwareScheduleSnapshot(
  dataDir: string,
  date: string,
): VerifiedJunkwareScheduleSnapshot | null {
  const snapshot = readVerifiedJunkwareScheduleSnapshot(dataDir, date);
  if (!snapshot) return null;
  return snapshot.updatedAtMs > canonicalJunkwareUpdatedAtMs(dataDir, date) + 1_000
    ? snapshot
    : null;
}
