import assert from 'node:assert/strict';
import { buildKreweHours } from '../lib/desktop-krewe-hours';
import { payPeriodDates } from '../lib/pay-period';
import type { PayrollCorrection } from '../lib/payroll-corrections';

const period = payPeriodDates('2026-09-05');
assert.deepEqual([period.start, period.end], ['2026-08-24', '2026-09-06']);
const source = new Map(period.dates.map((date, i) => [date, { payroll_records: [{ name: 'Test Employee', hours_worked: i < 5 ? 9 : i >= 7 && i < 11 ? 8 : 0 }] }]));
const now = new Date('2026-09-07T12:00:00Z');
const before = JSON.stringify([...source]);
const result = buildKreweHours('2026-09-05', source, new Map(), now);
const employee = result.employees[0];
assert.deepEqual(employee.weeks.map(week => [week.total, week.regular, week.overtime]), [[45, 40, 5], [32, 32, 0]]);
assert.equal(employee.total, 77); // Never use an 80-hour period threshold.
assert.deepEqual(employee.weeks.map(week => week.days.length), [7, 7]);
assert.equal(JSON.stringify([...source]), before);

const correction = { employeeName: 'Test Employee', clockIn: '8:00 AM', clockOut: '12:00 PM' } as PayrollCorrection;
const corrected = buildKreweHours('2026-09-05', source, new Map([['2026-08-24', { 'test employee': correction }]]), now);
assert.equal(corrected.employees[0].weeks[0].total, 40);
assert.equal(corrected.employees[0].weeks[0].overtime, 0);
assert.equal(corrected.employees[0].weeks[0].days[0].corrected, true);

const emptySecond = new Map([...source].filter(([date]) => date < '2026-08-31'));
const partial = buildKreweHours('2026-08-24', emptySecond, new Map(), now);
assert.equal(partial.employees[0].weeks.length, 2);
assert.equal(partial.employees[0].weeks[1].total, null);
assert.equal(partial.employees[0].weeks[1].incomplete, true);
assert.equal(partial.missingDates.length, 7);
const early = buildKreweHours('2026-08-24', emptySecond, new Map(), new Date('2026-08-25T12:00:00Z'));
assert.ok(early.employees[0].weeks[1].days.every(day => day.status === 'Upcoming'));
assert.equal(early.employees[0].weeks[1].incomplete, false);

const open = new Map([['2026-09-05', { payroll_records: [{ name: 'Test Employee', hours_worked: 2, clock_in: '8:00 AM', clock_out: '' }] }]]);
const current = buildKreweHours('2026-09-05', open, new Map(), new Date('2026-09-05T17:00:00Z'));
assert.equal(current.employees[0].weeks[1].days[5].hours, 4);
assert.equal(current.employees[0].weeks[1].days[5].status, 'On Shift');
const stale = buildKreweHours('2026-09-05', open, new Map(), now);
assert.equal(stale.employees[0].weeks[1].days[5].hours, 2);
assert.equal(stale.employees[0].weeks[1].days[5].status, 'Missing Clock-Out');

const aliases = new Map([['2026-09-05', { payroll_records: [{ name: 'Employee, Test', hours_worked: 4 }], employee_leaderboard: [{ name: 'Test Employee', hours_worked: 9 }] }]]);
assert.equal(buildKreweHours('2026-09-05', aliases, new Map(), now).employees.length, 1);
assert.equal(buildKreweHours('2026-09-05', aliases, new Map(), now).employees[0].total, 4);
console.log('Desktop Krewe hours: weekly boundaries, OT, corrections, missing/future weeks, open shifts, source priority, and source preservation passed.');
