import { promises as fs } from "fs";
import path from "path";
import type { DailyMetrics, MetricsResult } from "@/types/metrics";
import { chicagoDateKey } from "@/lib/report-dates";

export async function getDailyMetrics(dateKey?: string): Promise<MetricsResult> {
  const todayKey = chicagoDateKey();
  const resolvedDate = dateKey ?? todayKey;
  const dataRoot = path.resolve(process.cwd(), "data");
  const dataPaths = [
    path.join(dataRoot, "history", "daily_metrics", `daily_metrics_${resolvedDate}.json`),
  ];

  for (let i = 0; i < dataPaths.length; i++) {
    const dataPath = dataPaths[i];
    try {
      const [raw, stat] = await Promise.all([fs.readFile(dataPath, "utf8"), fs.stat(dataPath)]);
      console.log(`[metrics]\nrequested=${dateKey ?? "(none)"}\nresolved=${resolvedDate}\npath=${dataPath}\nfallback=${i > 0}`);
      return { metrics: JSON.parse(raw) as DailyMetrics, dataPath, lastUpdated: stat.mtime.toISOString() };
    } catch {
      // File not found or unreadable — try next path or return empty state below.
    }
  }
  console.log(`[metrics]\nrequested=${dateKey ?? "(none)"}\nresolved=${resolvedDate}\npath=${dataPaths[0]}\nfallback=false\nerror=file-not-found`);
  return { metrics: null, dataPath: dataPaths[0], error: "Unable to read daily metrics" };
}

export function entries(data?: Record<string, string | number>): Array<[string, string | number]> {
  return Object.entries(data ?? {}).filter(([name]) => name.trim().length > 0);
}

export function numericEntries(data?: Record<string, number>): Array<[string, number]> {
  return Object.entries(data ?? {}).filter(([, value]) => Number.isFinite(value));
}

export function money(value?: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value ?? 0);
}

export function number(value?: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value ?? 0);
}

export function totalRecordValues(data?: Record<string, number>): number {
  return numericEntries(data).reduce((sum, [, value]) => sum + value, 0);
}
