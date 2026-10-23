import { isOperatingDay, shiftOperatingDay } from './operating-day';
export type RevenueDay = { date: string; revenue: number | null };
export function previousYearDay(date: string) {
  const target = `${Number(date.slice(0,4)) - 1}${date.slice(4)}`;
  return isOperatingDay(target) ? target : null;
}
/** A missing day breaks the cumulative series; never treat it as zero or bridge it. */
export function revenuePaceRows(days: RevenueDay[], start: string, end: string) {
  if (!isOperatingDay(start) || !isOperatingDay(end) || start > end || end > shiftOperatingDay(start,365)) return [];
  const history = new Map(days.map(day => [day.date,day.revenue]));
  const rows = []; let current: number | null = 0, prior: number | null = 0;
  for(let date = start; date <= end; date = shiftOperatingDay(date,1)) {
    const value = history.get(date), priorDate = previousYearDay(date), old = priorDate ? history.get(priorDate) : null;
    const daily = value != null && Number.isFinite(value) ? value : null;
    const priorDaily = old != null && Number.isFinite(old) ? old : null;
    current = current != null && daily != null ? current + daily : null;
    prior = prior != null && priorDaily != null ? prior + priorDaily : null;
    rows.push({date,label:date.slice(5),daily,priorDaily,current,prior,priorDate});
  }
  return rows;
}
