import type { HoursDay, KreweHoursSnapshot } from './krewe-hours-contract';
import type { DesktopCrewMember, DesktopKreweSnapshot } from './people-fleet-contract';
import { payForDays, payBreakdownDifference, type PayBreakdown } from './krewe-pay-breakdown';

export type PayrollReviewRow = {
  id: string; name: string; hours: number | null; regular: number; overtime: number;
  pay: PayBreakdown; weeks: Array<{ start: string; end: string; hours: number | null; pay: PayBreakdown }>;
  issues: Array<{ date: string; message: string }>; signature: string;
};
const known = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const cents = (value: number) => Math.round(value * 100);
export function recordedPayrollClock(value: string | undefined): string {
  const text = (value || '').trim();
  return /^(?:(?:0?[1-9]|1[0-2]):[0-5]\d\s*(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d)$/i.test(text) ? text : '';
}

/** Same displayed daily earnings as Krewe. Never infer wages or turn missing pay into zero. */
export function buildPayrollReview(hours: KreweHoursSnapshot, payroll: DesktopKreweSnapshot): PayrollReviewRow[] {
  if (hours.date !== payroll.date || hours.start !== payroll.start || payroll.view !== 'payperiod') return [];
  const members = new Map(payroll.members.map(member => [member.id, member]));
  return hours.employees.map(employee => {
    const member = members.get(employee.id);
    const days = (member?.days || []).filter(day => day.date >= hours.start && day.date <= hours.end);
    const issues: PayrollReviewRow['issues'] = [];
    const add = (date: string, message: string) => { if (!issues.some(issue => issue.date === date && issue.message === message)) issues.push({ date, message }); };
    const byDate = new Map(days.map(day => [day.date, day]));
    const reviewDay = (day: HoursDay, payDay: DesktopCrewMember['days'][number] | undefined) => {
      if (day.status === 'Upcoming') return;
      const clockIn = recordedPayrollClock(day.clockIn) || recordedPayrollClock(payDay?.clockIn);
      const clockOut = recordedPayrollClock(day.clockOut) || recordedPayrollClock(payDay?.clockOut);
      if (['Source Unavailable', 'Hours Unavailable', 'No Record'].includes(day.status) || !clockOut && ['Missing Clock-Out', 'On Shift'].includes(day.status)) add(day.date, day.status);
      // An absent employee row does not establish a missed shift. Flag it when
      // job, clock, pay or correction evidence says this employee worked.
      const activity = (day.hours ?? 0) > 0 || (day.jobs ?? 0) > 0 || !!clockIn || !!clockOut || day.corrected ||
        !!payDay && [payDay.hours, payDay.labor, payDay.tips, payDay.bonuses, payDay.supplemental, payDay.totalPay].some(value => known(value) && value !== 0);
      if (activity && !day.isSalary && (!clockIn || !clockOut)) add(day.date, 'Clock-in or clock-out missing');
      if (activity && !payDay) add(day.date, 'Pay record missing');
      if (payDay) {
        const pay = payForDays([payDay], day.date, day.date);
        if (Object.values(pay).some(value => !known(value))) add(day.date, 'Pay breakdown incomplete');
        const difference = payBreakdownDifference(pay);
        if (difference !== null && Math.abs(cents(difference)) > 1) add(day.date, 'Pay total does not match its components');
        if (Object.values(pay).some(value => known(value) && value < 0)) add(day.date, 'Negative pay amount requires review');
        if (known(day.hours) && known(payDay.hours) && Math.abs(day.hours - payDay.hours) > .02) add(day.date, 'Time and pay records disagree on hours');
        if (payDay.issue) add(day.date, payDay.issue);
        if (payDay.syncStatus && payDay.syncStatus !== 'verified') add(day.date, `JunkWare correction ${payDay.syncStatus}`);
        if (day.corrected && !payDay.syncStatus) add(day.date, 'Correction not verified in JunkWare');
      }
    };
    employee.weeks.forEach(week => week.days.forEach(day => reviewDay(day, byDate.get(day.date))));
    if (!member) add('', 'Employee pay records unavailable');
    const pay = payForDays(days, hours.start, hours.end);
    if (Object.values(pay).some(value => !known(value))) add('', 'Period earnings incomplete');
    if (!known(employee.total)) add('', 'Period hours unavailable');
    const row = { id: employee.id, name: employee.name, hours: employee.total,
      regular: employee.weeks.reduce((sum, week) => sum + week.regular, 0), overtime: employee.weeks.reduce((sum, week) => sum + week.overtime, 0), pay,
      weeks: employee.weeks.map(week => ({ start: week.start, end: week.end, hours: week.total, pay: payForDays(days, week.start, week.end) })), issues };
    // Refresh timestamps alone do not erase a review; changes to its actual
    // evidence, correction status, dates, or totals do. Nothing persists in storage.
    const evidence = days.map(({ sourceAt: _sourceAt, ...day }) => day);
    return { ...row, signature: JSON.stringify([hours.start, hours.end, row, employee.weeks, evidence, payroll.missingDates, hours.missingDates]) };
  });
}

export function reviewedPayrollRows(rows: PayrollReviewRow[], marks: Record<string, string>) {
  return rows.filter(row => !row.issues.length && marks[row.id] === row.signature);
}

/** Quoted cells still need formula-injection protection in spreadsheet apps. */
function csvCell(value: string | number | null) {
  const text = value === null ? '' : typeof value === 'number' ? value.toFixed(2) : value;
  return `"${(/^[\s\uFEFF]*[=+@-]/.test(text) && typeof value !== 'number' ? `'${text}` : text).replace(/"/g, '""')}"`;
}
export function payrollReviewCsv(input: { rows: PayrollReviewRow[]; start: string; end: string; retrievedAt: string; reviewed: boolean; warnings: string[] }) {
  if (input.reviewed && (input.warnings.length || input.rows.some(row => row.issues.length))) throw new Error('Resolve the review flags before exporting reviewed totals.');
  const headers = ['Employee', 'Employee key', 'Period start', 'Period end', 'Week 1 hours', 'Week 2 hours', 'Total hours', 'Regular hours', 'Overtime hours', 'Hourly pay', 'Tips', 'Bonuses', 'Supplemental pay', 'Total pay before deductions', 'Review status', 'Flags', 'Snapshot retrieved at'];
  return '\uFEFF' + [headers, ...input.rows.map(row => [row.name, row.id, input.start, input.end, row.weeks[0]?.hours ?? null, row.weeks[1]?.hours ?? null, row.hours, row.regular, row.overtime, row.pay.labor, row.pay.tips, row.pay.bonuses, row.pay.supplemental, row.pay.totalPay,
    input.reviewed ? 'Reviewed in this session' : 'Draft - not reviewed', [...input.warnings, ...row.issues.map(issue => `${issue.date} ${issue.message}`.trim())].join('; '), input.retrievedAt])].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
