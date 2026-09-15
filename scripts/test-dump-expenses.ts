import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { geofenceEntries, geofenceVisits } from '../lib/linxup-geofence-alerts';
import { projectDumpExpenses, parseDumpFeePolicy } from '../lib/dump-expense-policy';
import { defaultDumpFeePolicy, readDumpExpenses, assumedDumpExpenseAlerts } from '../lib/dump-expenses';
import type { TruckExpense } from '../lib/truck-expense-notifications';

const date = '2026-09-15';
const at = (time: string, day = date) => `${day}T${time}:00-05:00`;
const now = Date.parse(at('23:59', '2026-09-17'));
const transition = (type: string, time: string, name = 'GL', truck = '9', day = date) => ({ alert_type: `geofence_${type}`, occurred_at: at(time, day), geofence_name: name, truck_number: truck });
const source = [transition('entered', '10:00'), transition('exited', '10:30')];
const actual = (time: string, patch: Partial<TruckExpense> = {}): TruckExpense => ({ id: 'a'.repeat(32), date, truck: 'Truck# 9', market: '477', kind: 'dump', transactionAt: at(time), location: 'Gentilly Landfill', amount: 70, receipt: '', notify: false, ...patch });
const project = (expenses: TruckExpense[] = [], rows = source, clock = now) => {
  const days = [date, '2026-09-16'];
  return projectDumpExpenses(date, days.flatMap(day => geofenceEntries(day, rows, clock)), days.flatMap(day => geofenceVisits(day, rows, clock)), expenses, defaultDumpFeePolicy, clock);
};
assert.ok(parseDumpFeePolicy(defaultDumpFeePolicy));
assert.equal(parseDumpFeePolicy({ ...defaultDumpFeePolicy, defaultMinimumFee: -1 }), null);
assert.equal(parseDumpFeePolicy({ ...defaultDumpFeePolicy, facilities: [{ name: 'A', aliases: ['a'], minimumFee: 1 }] }), null);
assert.equal(project()[0].amount, 44);
assert.equal(project()[0].status, 'assumed');
assert.equal(project([], source, Date.parse(at('10:15')))[0].window, 'onsite');
assert.equal(project([], source, Date.parse(at('11:00')))[0].window, 'open');
assert.equal(project()[0].window, 'closed');
for (const time of ['10:00', '10:15', '10:30', '11:29', '11:30']) {
  const records = project([actual(time)]);
  assert.equal(records.length, 1, time);
  assert.equal(records[0].status, 'actual', time);
  assert.equal(records[0].amount, 70);
  assert.equal(records[0].id, project()[0].id, 'Replacement retains visit identity');
}
assert.equal(project([actual('11:31')]).length, 2, 'After deadline, actual is separate');
assert.equal(project([actual('11:30', { transactionAt: `${date}T11:30:00.001-05:00` })]).length, 2, 'One millisecond late does not replace');
assert.equal(project([actual('09:59')]).length, 2, 'Before arrival cannot replace');
assert.equal(project([actual('11:00', { truck: 'Truck# 8' })])[0].status, 'actual');
assert.ok(project([actual('11:00', { truck: 'Truck# 8' })]).some(record => record.status === 'assumed'));
assert.equal(project([actual('11:00', { kind: 'fuel' })])[0].status, 'assumed');
assert.ok(project([actual('11:00', { location: 'Stranco' })]).some(record => record.status === 'assumed'));
assert.equal(project([actual('11:00', { location: '' })]).length, 1, 'One unambiguous visit can match an unspecified location');
assert.equal(project([actual('11:00'), actual('11:00')]).length, 1, 'Source retries deduplicate');
assert.equal(project([], [...source, ...source]).length, 1, 'Geofence retries deduplicate');
assert.equal(project([], [transition('entered', '10:00'), transition('entered', '10:01'), transition('exited', '10:30')]).length, 1, 'Repeated entry before an exit is one visit');
const twice = [...source, transition('entered', '11:00'), transition('exited', '11:10')];
const matched = project([actual('11:15')], twice);
assert.equal(matched.length, 2);
assert.equal(matched.find(record => record.status === 'actual')?.enteredAt, new Date(at('11:00')).toISOString(), 'One expense replaces the most recent eligible visit');
assert.equal(project([actual('11:15', { location: '' })], twice).length, 3, 'Ambiguous location cannot remove either assumption');
assert.equal(project([], [transition('exited', '10:30')]).length, 0, 'Exit alone cannot invent a charged entry');
assert.equal(project([], [transition('entered', '10:00', 'Warehouse')]).length, 0);
assert.equal(project([], [transition('entered', '10:00', 'EMR')]).length, 0);
assert.equal(project([], [transition('entered', '10:00', 'Test Dump')])[0].status, 'minimum_missing');
for (const [name, fee] of [['STS', 85], ['BRL', 44], ['RBL', 47]] as const) assert.equal(project([], [transition('entered', '10:00', name)])[0].amount, fee);
const overnight = [transition('entered', '23:30'), transition('exited', '00:10', 'GL', '9', '2026-09-16')];
assert.equal(project([actual('00:59', { date: '2026-09-16', transactionAt: at('00:59', '2026-09-16') })], overnight)[0].status, 'actual');
assert.equal(project([actual('01:11', { date: '2026-09-16', transactionAt: at('01:11', '2026-09-16') })], overnight)[0].status, 'assumed');
assert.equal(projectDumpExpenses('2026-09-14', geofenceEntries('2026-09-14', [transition('entered', '10:00', 'GL', '9', '2026-09-14')], now), [], [], defaultDumpFeePolicy, now).length, 0, 'No retroactive assumptions before the requested rule');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dump-expenses-'));
const originalRoot = process.env.OPSCENTER_DATA_DIR;
process.env.OPSCENTER_DATA_DIR = root;
const write = (file: string, value: unknown) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(value)); };
try {
  // Past clock fixtures exercise real filesystem readers, Command and Finance projection.
  const testDate = '2026-09-14';
  write('config/dump-minimum-fees.json', { ...defaultDumpFeePolicy, effectiveFrom: testDate });
  const rows = [transition('entered', '10:00', 'GL', '9', testDate), transition('exited', '10:30', 'GL', '9', testDate)];
  write(`history/linxup/alerts/linxup_alerts_${testDate}.json`, { date: testDate, alerts: rows, pagination_completed: true, validation_status: 'passed' });
  assert.equal(readDumpExpenses(testDate).assumedTotal, 44);
  assert.equal(assumedDumpExpenseAlerts(testDate).length, 1);
  write(`history/junkware/expenses/${testDate}/477/9.json`, { date: testDate, market: '477', truck: 'Truck# 9', verified: true, entries: [actual('11:00', { date: testDate, transactionAt: at('11:00', testDate) })] });
  const replaced = readDumpExpenses(testDate);
  assert.equal(replaced.assumedTotal, 0);
  assert.equal(replaced.actualTotal, 70);
  assert.equal(replaced.total, 70);
  assert.equal(replaced.records.length, 1);
  assert.equal(assumedDumpExpenseAlerts(testDate).length, 0);
  write('config/dump-minimum-fees.json', { broken: true });
  assert.equal(readDumpExpenses(testDate).policyAvailable, false);
  console.log('Dump expense tests passed: rates, entry/exit windows, replacement, isolation, repeat visits, midnight, config and filesystem integration.');
} finally {
  if (originalRoot === undefined) delete process.env.OPSCENTER_DATA_DIR; else process.env.OPSCENTER_DATA_DIR = originalRoot;
  fs.rmSync(root, { recursive: true, force: true });
}
