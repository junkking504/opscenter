export type CalendarCell = {
  date: string;
  day: number;
};

export function calendarMonthKey(date: string): string {
  return /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "";
}

export function shiftCalendarMonth(monthKey: string, offset: number): string {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1, 12));
  return date.toISOString().slice(0, 7);
}

export function calendarMonthLabel(monthKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${monthKey}-01T12:00:00Z`));
}

export function calendarMonthCells(monthKey: string): Array<CalendarCell | null> {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1, 12)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const cells: Array<CalendarCell | null> = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: `${monthKey}-${String(day).padStart(2, "0")}`, day });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
