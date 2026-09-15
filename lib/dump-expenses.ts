import fs from 'node:fs';
import path from 'node:path';
import { readGeofenceEntries } from './linxup-geofence-alerts';
import { readTruckExpenses } from './truck-expense-notifications';
import { parseDumpFeePolicy, projectDumpExpenses, type DumpFeePolicy } from './dump-expense-policy';
import type { OperationalAlert } from './operational-alert-presentation';

// User-supplied minimums, effective from the date this operating rule was requested.
export const defaultDumpFeePolicy: DumpFeePolicy = {
  effectiveFrom: '2026-09-15',
  facilities: [
    { name: 'Gentilly', aliases: ['Gentilly Landfill', 'GL'], minimumFee: 44 },
    { name: 'Stranco', aliases: ['Stranco Transfer Station', 'STS'], minimumFee: 85 },
    { name: 'Baton Rouge Landfill', aliases: ['BRL', 'EBR', 'EBR Landfill', 'BR Landfill', 'BR Landfilll'], minimumFee: 44 },
    { name: 'River Birch', aliases: ['River Birch Landfill', 'RBL'], minimumFee: 47 },
  ],
};
export function readDumpFeePolicy(): DumpFeePolicy | null {
  const root = process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), 'data');
  try { return parseDumpFeePolicy(JSON.parse(fs.readFileSync(path.join(root, 'config', 'dump-minimum-fees.json'), 'utf8'))); }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? defaultDumpFeePolicy : null; }
}
export function readDumpExpenses(date: string, now = Date.now()) {
  const policy = readDumpFeePolicy();
  const days = /^\d{4}-\d{2}-\d{2}$/.test(date) ? [-1, 0, 1, 2].map(offset => new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)) : [];
  const snapshots = days.map(day => readGeofenceEntries(day));
  const records = projectDumpExpenses(date, snapshots.flatMap(snapshot => snapshot.entries), snapshots.flatMap(snapshot => snapshot.visits), days.flatMap(readTruckExpenses), policy, now);
  const total = (status: 'actual' | 'assumed') => Math.round(records.filter(record => record.status === status).reduce((sum, record) => sum + (record.amount ?? 0), 0) * 100) / 100;
  const missingMinimumCount = records.filter(record => record.status === 'minimum_missing').length;
  return { date, policyAvailable: Boolean(policy), geofencesAvailable: snapshots[1]?.available ?? false,
    observedAt: snapshots[1]?.observedAt || null, records, actualTotal: total('actual'), assumedTotal: total('assumed'),
    total: missingMinimumCount ? null : Math.round((total('actual') + total('assumed')) * 100) / 100, missingMinimumCount };
}
const clock = (value: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
export function assumedDumpExpenseAlerts(date: string): OperationalAlert[] {
  return readDumpExpenses(date).records.filter(record => record.status !== 'actual').map(record => ({
    id: record.id, eventFingerprint: record.id, timestamp: record.transactionAt, source: 'OpsCenter',
    label: 'Dump Expense', domain: 'Fleet', owner: 'Fleet', truck: record.truck,
    detected: clock(record.transactionAt), title: `${record.truck} · Assumed dump expense`,
    needsAction: record.status === 'minimum_missing',
    facts: [{ label: 'Amount', value: record.amount === null ? 'Minimum fee needed' : `$${record.amount.toFixed(2)} · assumed minimum` },
      { label: 'Location', value: record.location }, { label: 'Entered', value: clock(record.enteredAt!) },
      { label: 'Departed', value: record.departedAt ? clock(record.departedAt) : 'Awaiting geofence exit' },
      { label: 'Actual expense deadline', value: record.replaceUntil ? clock(record.replaceUntil) : 'One hour after exit' }],
    next: record.status === 'minimum_missing' ? 'Set this facility’s minimum fee.' : record.window === 'closed'
      ? 'Minimum fee retained; no matching expense was recorded by the deadline.'
      : 'A matching JunkWare dump expense recorded by one hour after exit replaces this assumption.',
    href: `/desktop?workspace=Finance&date=${encodeURIComponent(date)}`,
  }));
}
