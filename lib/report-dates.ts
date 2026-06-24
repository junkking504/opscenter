import { historyIndex } from "@/lib/history-data";

export const EARLIEST_REPORT_DATE = "2026-06-15";

export type ReportDateOption = {
  key: string;
  label: string;
  date: string;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function chicagoDateKey(reference = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(reference);
}

export function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function isValidDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function clampReportDate(value?: string | null) {
  if (!value || !isValidDateKey(value)) return undefined;
  if (value < EARLIEST_REPORT_DATE) return EARLIEST_REPORT_DATE;
  return value;
}

export function resolveReportDate(value?: string | string[] | null) {
  const raw = Array.isArray(value) ? value[0] : value;
  return clampReportDate(raw);
}

type HistoryIndex = {
  dates?: string[];
  selector?: {
    available_dates?: string[];
    shortcuts?: {
      today?: string;
      yesterday?: string;
    };
  };
};

function readHistoryIndex(): HistoryIndex | null {
  return historyIndex as HistoryIndex;
}

export async function reportDateOptions(): Promise<ReportDateOption[]> {
  const today = chicagoDateKey();
  const index = readHistoryIndex();
  const availableDates: string[] = index?.selector?.available_dates ?? index?.dates ?? [];

  // Always include today; merge with history dates, deduplicate, sort newest-first.
  const dateSet = new Set([today, ...availableDates]);
  const sorted = Array.from(dateSet).sort().reverse();

  return sorted.map((date) => ({
    key: date,
    label: reportDateLabel(date),
    date,
  }));
}

export function reportDateLabel(dateKey?: string) {
  if (!dateKey) return "today";
  const today = chicagoDateKey();
  if (dateKey === today) return "Today";
  return dateKey; // YYYY-MM-DD — no weekday names, no Yesterday
}
