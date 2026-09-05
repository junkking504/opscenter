import { readMetrics, type AnyRecord } from '@/lib/opsData';
import { payPeriodDates, addDateKeyDays } from '@/lib/pay-period';
import { normalizePayrollEmployeeKey, payrollCorrectionsForDate, type PayrollCorrection } from '@/lib/payroll-corrections';
import { chicagoClockToDate, MAX_SHIFT_SECONDS } from '@/lib/live-pay';
import { chicagoDateKey } from '@/lib/report-dates';
import { calculateWeeklyOvertime } from '@/lib/overtime';
import type { HoursDay, KreweHoursSnapshot } from '../desktop-ui/lib/krewe-hours-contract';

const nameOf = (row: AnyRecord) => String(row.name || row.employee_name || row.employee || row.crew_member || '').trim();
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
function recordedHours(row: AnyRecord): number | null {
  for (const key of ['hours_worked', 'hours', 'labor_hours', 'worked_hours']) {
    if (row[key] === null || row[key] === undefined || row[key] === '') continue;
    const n = Number(row[key]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}
function rowsFor(metrics: AnyRecord | null) {
  const rows = new Map<string, AnyRecord>();
  // Same daily source priority as the existing Krewe pay-period records.
  for (const list of [metrics?.payroll_records, metrics?.employee_leaderboard, metrics?.employees, metrics?.crew]) {
    if (!Array.isArray(list)) continue;
    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      const key = normalizePayrollEmployeeKey(nameOf(row));
      if (key && !rows.has(key)) rows.set(key, row);
    }
  }
  return rows;
}

export function buildKreweHours(date: string, sources: Map<string, AnyRecord | null>, corrections: Map<string, Record<string, PayrollCorrection>>, now = new Date()): KreweHoursSnapshot {
  const period = payPeriodDates(date);
  const today = chicagoDateKey(now);
  const roster = new Map<string, string>();
  const rows = new Map(period.dates.map(day => [day, rowsFor(sources.get(day) || null)]));
  for (const day of period.dates.filter(day => day <= today)) {
    for (const [id, row] of rows.get(day)!) roster.set(id, nameOf(row));
    for (const [id, correction] of Object.entries(corrections.get(day) || {})) roster.set(id, correction.employeeName);
  }
  return {
    date, start: period.start, end: period.end, generatedAt: now.toISOString(),
    missingDates: period.dates.filter(day => day <= today && !sources.get(day)),
    employees: [...roster].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => {
      const weeks = [0, 7].map(offset => {
        const start = addDateKeyDays(period.start, offset);
        const days = period.dates.slice(offset, offset + 7).map(day => {
          const row = rows.get(day)?.get(id);
          const correction = corrections.get(day)?.[id];
          const clockIn = correction ? correction.clockIn : String(row?.clock_in || row?.time_in || row?.clock_in_display || row?.timeIn || '');
          const clockOut = correction ? correction.clockOut : String(row?.clock_out || row?.time_out || row?.clock_out_display || row?.timeOut || '');
          let hours = row ? recordedHours(row) : null;
          let status: HoursDay['status'] = hours === null ? 'Hours Unavailable' : 'Recorded';
          const inTime = chicagoClockToDate(day, clockIn);
          const outTime = chicagoClockToDate(day, clockOut);
          if (correction || (inTime && !outTime)) {
            const end = outTime || (day === today ? now : null);
            const seconds = inTime && end ? (end.getTime() - inTime.getTime()) / 1000 : null;
            if (seconds !== null && seconds >= 0 && seconds <= MAX_SHIFT_SECONDS) {
              hours = seconds / 3600;
              status = outTime ? 'Recorded' : 'On Shift';
            } else {
              // Retain recorded historical hours, but never extrapolate an old
              // open shift. A correction supersedes the original hours entirely.
              hours = correction ? null : hours;
              status = inTime && !outTime ? 'Missing Clock-Out' : 'Hours Unavailable';
            }
          }
          if (day > today) { hours = null; status = 'Upcoming'; }
          else if (!sources.get(day) && !correction) { hours = null; status = 'Source Unavailable'; }
          else if (!row && !correction) { hours = null; status = 'No Record'; }
          return { date: day, hours, clockIn, clockOut, corrected: Boolean(correction), status, regular: 0, overtime: 0, salary: Boolean(row?.is_salary) };
        });
        const allocation = calculateWeeklyOvertime(days.map(day => ({ hours: day.hours ?? 0, isSalary: day.salary })));
        days.forEach((day, i) => { day.regular = round(allocation[i].regularHours); day.overtime = round(allocation[i].overtimeHours); });
        const known = days.some(day => day.hours !== null);
        return { start, end: addDateKeyDays(start, 6), total: known ? round(days.reduce((sum, day) => sum + (day.hours ?? 0), 0)) : null,
          regular: round(allocation.reduce((sum, day) => sum + day.regularHours, 0)), overtime: round(allocation.reduce((sum, day) => sum + day.overtimeHours, 0)),
          incomplete: days.some(day => !['Recorded', 'Upcoming'].includes(day.status)), days: days.map(day => ({ date: day.date, hours: day.hours, regular: day.regular, overtime: day.overtime, clockIn: day.clockIn, clockOut: day.clockOut, corrected: day.corrected, status: day.status })) };
      });
      return { id, name, weeks, total: weeks.some(week => week.total !== null) ? round(weeks.reduce((sum, week) => sum + (week.total ?? 0), 0)) : null };
    }),
  };
}

export function readKreweHours(date: string): KreweHoursSnapshot {
  const days = payPeriodDates(date).dates;
  return buildKreweHours(date, new Map(days.map(day => [day, readMetrics(day)])), new Map(days.map(day => [day, payrollCorrectionsForDate(day)])));
}
