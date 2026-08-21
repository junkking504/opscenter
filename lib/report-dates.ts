import { historyIndex } from "@/lib/history-data";
import { chicagoDateKey, addDays } from "@/lib/chicago-date";

export const EARLIEST_REPORT_DATE = "2026-06-15";

export type ReportDateOption = {
  key: string;
  label: string;
  date: string;
};

// Re-exported so the many existing `@/lib/report-dates` importers keep
// working unchanged. The actual implementation lives in the dependency-free
// `@/lib/chicago-date`, which is also safe to import from client components.
export { chicagoDateKey, addDays };

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
