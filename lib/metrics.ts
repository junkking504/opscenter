import type { DailyMetrics, MetricsResult } from "@/types/metrics";
import { chicagoDateKey } from "@/lib/report-dates";
import { dailyMetricsByDate } from "@/lib/history-data";

export async function getDailyMetrics(dateKey?: string): Promise<MetricsResult> {
  const todayKey = chicagoDateKey();
  const resolvedDate = dateKey ?? todayKey;

  const metrics = dailyMetricsByDate[resolvedDate as keyof typeof dailyMetricsByDate] as DailyMetrics | undefined;

  if (!metrics) {
    return {
      metrics: null,
      dataPath: `data/history/daily_metrics/daily_metrics_${resolvedDate}.json`,
      error: "Unable to read daily metrics"
    };
  }

  return {
    metrics,
    dataPath: `data/history/daily_metrics/daily_metrics_${resolvedDate}.json`,
    lastUpdated: undefined
  };
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
