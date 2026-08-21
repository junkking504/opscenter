const DEFAULT_PAY_PERIOD_ANCHOR = "2026-08-03";
export const PAY_PERIOD_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function validDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return Number.isFinite(new Date(`${value}T12:00:00Z`).getTime());
}

export function addDateKeyDays(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dayDifference(a: string, b: string): number {
  const aTime = new Date(`${a}T12:00:00Z`).getTime();
  const bTime = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((aTime - bTime) / DAY_MS);
}

export function payPeriodForDate(selectedDate: string): { start: string; end: string } {
  const configuredAnchor = String(process.env.OPS_PAY_PERIOD_ANCHOR || DEFAULT_PAY_PERIOD_ANCHOR).trim();
  const anchor = validDateKey(configuredAnchor) ? configuredAnchor : DEFAULT_PAY_PERIOD_ANCHOR;
  const date = validDateKey(selectedDate) ? selectedDate : anchor;
  const periodIndex = Math.floor(dayDifference(date, anchor) / PAY_PERIOD_DAYS);
  const start = addDateKeyDays(anchor, periodIndex * PAY_PERIOD_DAYS);
  return { start, end: addDateKeyDays(start, PAY_PERIOD_DAYS - 1) };
}

export function payPeriodDates(selectedDate: string): { start: string; end: string; dates: string[] } {
  const period = payPeriodForDate(selectedDate);
  const dates: string[] = [];
  for (let date = period.start; date <= period.end; date = addDateKeyDays(date, 1)) {
    dates.push(date);
  }
  return { ...period, dates };
}
