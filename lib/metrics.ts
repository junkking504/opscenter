import fs from "fs";
import path from "path";

export type DailyMetrics = Record<string, any>;

export type MetricsResult = {
  metrics: DailyMetrics | null;
  dataPath: string;
  lastUpdated?: string;
  error?: string;
};

function chicagoDateKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function metricsDir(): string {
  return path.join(process.cwd(), "data", "history", "daily_metrics");
}

function metricPath(date: string): string {
  return path.join(metricsDir(), `daily_metrics_${date}.json`);
}

function scanAvailableDates(): string[] {
  try {
    if (!fs.existsSync(metricsDir())) return [];

    return fs
      .readdirSync(metricsDir())
      .map((name) => {
        const match = name.match(/^daily_metrics_(\d{4}-\d{2}-\d{2})\.json$/);
        return match?.[1];
      })
      .filter((date): date is string => Boolean(date))
      .sort();
  } catch {
    return [];
  }
}

function latestAvailableDate(): string | null {
  const dates = scanAvailableDates();
  return dates.length ? dates[dates.length - 1] : null;
}

function readMetrics(date: string): DailyMetrics | null {
  const filePath = metricPath(date);

  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as DailyMetrics;
  } catch {
    return null;
  }
}

export async function getDailyMetrics(dateKey?: string | null): Promise<MetricsResult> {
  const requestedDate = dateKey || chicagoDateKey();

  let metrics = readMetrics(requestedDate);
  let resolvedDate = requestedDate;

  // If today's file does not exist yet, fall back to latest available file.
  if (!metrics) {
    const latest = latestAvailableDate();
    if (latest) {
      resolvedDate = latest;
      metrics = readMetrics(latest);
    }
  }

  const relativeDataPath = `data/history/daily_metrics/daily_metrics_${resolvedDate}.json`;

  if (!metrics) {
    return {
      metrics: null,
      dataPath: relativeDataPath,
      error: "Unable to read daily metrics",
    };
  }

  return {
    metrics,
    dataPath: relativeDataPath,
    lastUpdated: metrics.generated_at ?? metrics.updated_at ?? undefined,
  };
}

export async function getMetricsForDate(dateKey?: string | null): Promise<MetricsResult> {
  return getDailyMetrics(dateKey);
}

export async function getCurrentMetrics(): Promise<MetricsResult> {
  return getDailyMetrics();
}

export function entries(data?: Record<string, string | number>): Array<[string, string | number]> {
  return Object.entries(data ?? {}).filter(([name]) => name.trim().length > 0);
}

export function numericEntries(data?: Record<string, number>): Array<[string, number]> {
  return Object.entries(data ?? {}).filter(([, value]) => Number.isFinite(Number(value)));
}

export function money(value?: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

export function number(value?: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(Number(value ?? 0));
}

export function totalRecordValues(data?: Record<string, number>): number {
  return numericEntries(data).reduce((sum, [, value]) => sum + Number(value ?? 0), 0);
}
