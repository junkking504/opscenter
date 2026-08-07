import fs from "fs";
import path from "path";

export type DailyMetrics = Record<string, any>;

const DATA_ROOT = path.join(process.cwd(), "data");
const HISTORY_DIR = path.join(DATA_ROOT, "history");
const DAILY_METRICS_DIR = path.join(HISTORY_DIR, "daily_metrics");
const HISTORY_INDEX_PATH = path.join(HISTORY_DIR, "history_index.json");

function readJsonFile<T = any>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function extractDatesFromIndex(index: any): string[] {
  if (!index) return [];

  if (Array.isArray(index.available_dates)) {
    return index.available_dates
      .map((d: any) => typeof d === "string" ? d : d?.date)
      .filter(Boolean)
      .sort();
  }

  if (Array.isArray(index.dates)) {
    return index.dates
      .map((d: any) => typeof d === "string" ? d : d?.date)
      .filter(Boolean)
      .sort();
  }

  return [];
}

function scanDailyMetricDates(): string[] {
  try {
    if (!fs.existsSync(DAILY_METRICS_DIR)) return [];

    return fs.readdirSync(DAILY_METRICS_DIR)
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

export function getAvailableDates(): string[] {
  const index = readJsonFile<any>(HISTORY_INDEX_PATH);
  const indexDates = extractDatesFromIndex(index);

  if (indexDates.length > 0) {
    return indexDates;
  }

  return scanDailyMetricDates();
}

export function getLatestDate(): string | null {
  const dates = getAvailableDates();
  return dates.length ? dates[dates.length - 1] : null;
}

export function getDailyMetrics(date?: string | null): DailyMetrics | null {
  const resolvedDate = date || getLatestDate();

  if (!resolvedDate) return null;

  const filePath = path.join(
    DAILY_METRICS_DIR,
    `daily_metrics_${resolvedDate}.json`
  );

  return readJsonFile<DailyMetrics>(filePath);
}

export function getMetricsForDate(date?: string | null): DailyMetrics | null {
  return getDailyMetrics(date);
}

export function getHistoryIndex(): any {
  const index = readJsonFile<any>(HISTORY_INDEX_PATH);

  if (index) {
    return index;
  }

  const dates = scanDailyMetricDates();

  return {
    dates,
    available_dates: dates,
    latest_date: dates.length ? dates[dates.length - 1] : null,
  };
}

export const availableDates = getAvailableDates();
export const historyIndex = getHistoryIndex();

export default historyIndex;
