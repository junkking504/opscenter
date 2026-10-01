import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCrewCallInPlan } from '../lib/crew-call-in-recommendations';
import { addDateKeyDays } from '../lib/pay-period';
import { upsertPayrollCorrection } from '../lib/payroll-corrections';

const originalCwd = process.cwd();
const originalDataDir = process.env.OPSBOT_DATA_DIR;
const originalAnchor = process.env.OPS_PAY_PERIOD_ANCHOR;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'call-in-period-'));
process.chdir(root);
process.env.OPSBOT_DATA_DIR = path.join(root, 'data');
process.env.OPS_PAY_PERIOD_ANCHOR = '2026-07-27';
const metricsDir = path.join(root, 'data/history/daily_metrics');
const scheduleDir = path.join(root, 'data/history/junkware');
fs.mkdirSync(metricsDir, { recursive: true });
fs.mkdirSync(scheduleDir, { recursive: true });
const writeMetrics = (date: string, rows: object[], payroll = rows) => fs.writeFileSync(
  path.join(metricsDir, `daily_metrics_${date}.json`), JSON.stringify({ employee_leaderboard: rows, payroll_records: payroll }),
);
const worker = (name: string, hours: number | null) => ({ name, hours_worked: hours, jobs_completed: 2, individual_revenue: 400, driver_trucks: ['Truck 1'] });
try {
  // Fully cover the history so these tests cannot fall through to live files.
  for (let date = '2026-08-18'; date <= '2026-09-20'; date = addDateKeyDays(date, 1)) writeMetrics(date, []);
  writeMetrics('2026-09-06', [worker('Previous Period', 8), worker('Corrected Worker', 8)]);
  writeMetrics('2026-09-07', [worker('Current Worker', 6), worker('Zero Hours', 0), worker('Unknown Hours', null), worker('Salary Worker', 8)],
    [worker('Worker, Current', 4), worker('Zero Hours', 0), worker('Unknown Hours', null), { ...worker('Salary Worker', 8), is_salary: true }]);
  // Salary exclusion continues to follow the performance source.
  const file = path.join(metricsDir, 'daily_metrics_2026-09-07.json');
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  payload.employee_leaderboard.find((row: {name: string}) => row.name === 'Salary Worker').is_salary = true;
  fs.writeFileSync(file, JSON.stringify(payload));
  for (const target of ['2026-09-08', '2026-09-20']) fs.writeFileSync(path.join(scheduleDir, `junkware_${target}_raw.json`), JSON.stringify({ appointments: [{ territory: 'Baton Rouge', appointment_time: '8:00 AM - 9:00 AM' }] }));
  const plan = buildCrewCallInPlan('2026-09-07');
  const candidates = [...plan.recommendations, ...plan.alternates];
  assert.deepEqual(candidates.map(row => row.name), ['Current Worker']);
  assert.equal(candidates[0].weeklyHours, 4, 'Use authoritative payroll hours rather than leaderboard hours');
  assert.equal(plan.callInCount, 2, 'Do not hide the staffing shortfall when eligibility removes people');
  assert.match(plan.note, /1 additional person/);

  upsertPayrollCorrection({ employeeName: 'Corrected Worker', workDate: '2026-09-07', clockIn: '8:00 AM', clockOut: '9:00 AM', hourlyRate: 16, note: 'Synthetic test shift' });
  const corrected = buildCrewCallInPlan('2026-09-07');
  assert.ok(corrected.recommendations.some(row => row.name === 'Corrected Worker'));
  assert.equal(corrected.recommendations.find(row => row.name === 'Corrected Worker')?.weeklyHours, 1);

  // A worker from the first week remains eligible during the second week.
  const secondWeek = buildCrewCallInPlan('2026-09-19');
  assert.ok([...secondWeek.recommendations, ...secondWeek.alternates].some(row => row.name === 'Current Worker'));
  assert.ok(![...secondWeek.recommendations, ...secondWeek.alternates].some(row => row.name === 'Previous Period'));
  // Applied corrections that remove all current-period hours remove eligibility.
  upsertPayrollCorrection({ employeeName: 'Current Worker', workDate: '2026-09-07', clockIn: '8:00 AM', clockOut: '8:00 AM', hourlyRate: 16, note: 'Synthetic zero-hour correction' });
  assert.ok(![...buildCrewCallInPlan('2026-09-07').recommendations, ...buildCrewCallInPlan('2026-09-07').alternates].some(row => row.name === 'Current Worker'));
  console.log('Call-in plan: current-period work, zero/unknown hours, salary, payroll priority, corrections, alternates and second-week eligibility passed.');
} finally {
  process.chdir(originalCwd);
  if (originalDataDir === undefined) delete process.env.OPSBOT_DATA_DIR; else process.env.OPSBOT_DATA_DIR = originalDataDir;
  if (originalAnchor === undefined) delete process.env.OPS_PAY_PERIOD_ANCHOR; else process.env.OPS_PAY_PERIOD_ANCHOR = originalAnchor;
  fs.rmSync(root, { recursive: true, force: true });
}
