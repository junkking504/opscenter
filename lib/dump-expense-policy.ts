import type { GeofenceEntry, GeofenceVisit } from './linxup-geofence-alerts';
import { geofenceFacility } from './linxup-geofence-alerts';
import type { TruckExpense } from './truck-expense-notifications';
import { chicagoDateKey } from './chicago-date';
import type { DumpExpenseRecord } from '../desktop-ui/lib/dump-expense-contract';

export type DumpFeePolicy = {
  effectiveFrom: string;
  defaultMinimumFee?: number;
  facilities: Array<{ name: string; aliases: string[]; minimumFee: number }>;
};
const HOUR = 3_600_000;
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const truckKey = (value: string) => value.match(/\d+/)?.[0];
const validFee = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.0001;

export function parseDumpFeePolicy(value: unknown): DumpFeePolicy | null {
  const policy = value as DumpFeePolicy | null;
  if (!policy || !/^\d{4}-\d{2}-\d{2}$/.test(policy.effectiveFrom) || !Array.isArray(policy.facilities)
    || (policy.defaultMinimumFee !== undefined && !validFee(policy.defaultMinimumFee))) return null;
  const names = new Set<string>();
  for (const facility of policy.facilities) {
    if (!facility || typeof facility.name !== 'string' || !Array.isArray(facility.aliases) || !validFee(facility.minimumFee)) return null;
    for (const alias of [facility.name, ...facility.aliases]) {
      if (typeof alias !== 'string' || !normalized(alias) || names.has(normalized(alias))) return null;
      names.add(normalized(alias));
    }
  }
  return policy;
}

const knownSites = [
  ['gentilly', 'gentilly landfill', 'gl'], ['river birch', 'river birch landfill', 'rbl'],
  ['stranco', 'stranco transfer station', 'sts'], ['green meadow', 'green meadow transfer station', 'mengel', 'gmts'],
  ['ebr', 'ebr landfill', 'baton rouge landfill', 'brl'],
];
function facilityKey(name: string, policy: DumpFeePolicy | null): string {
  const key = normalized(name);
  const configured = policy?.facilities.find(site => [site.name, ...site.aliases].some(alias => normalized(alias) === key));
  return configured ? normalized(configured.name) : knownSites.find(aliases => aliases.includes(key))?.[0] || key;
}

/** One operational expense per native entry/exit visit; actual source rows are never changed. */
export function projectDumpExpenses(date: string, entries: GeofenceEntry[], visits: GeofenceVisit[], expenses: TruckExpense[], policy: DumpFeePolicy | null, now = Date.now()): DumpExpenseRecord[] {
  const departed = new Map(visits.flatMap(visit => visit.entryIds.map(id => [id, visit] as const)));
  const records: DumpExpenseRecord[] = [];
  const seen = new Set<string>();
  const open = new Map<string, DumpExpenseRecord>();
  for (const entry of [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    if (entry.positionObserved || geofenceFacility(entry.name).resetLocation !== 'dump' || Date.parse(entry.timestamp) > now || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const day = chicagoDateKey(new Date(entry.timestamp));
    if (policy && day < policy.effectiveFrom) continue;
    const key = `${truckKey(entry.truck)}|${normalized(entry.name)}`;
    const previous = open.get(key);
    // Repeated entry reports without a departure describe the same visit.
    if (previous && (!previous.departedAt || Date.parse(entry.timestamp) <= Date.parse(previous.departedAt))) continue;
    const visit = departed.get(entry.id);
    const departedAt = visit?.departedAt || null;
    const replaceUntil = departedAt ? new Date(Date.parse(departedAt) + HOUR).toISOString() : null;
    const site = policy?.facilities.find(site => facilityKey(site.name, policy) === facilityKey(entry.name, policy));
    const fee = site?.minimumFee ?? policy?.defaultMinimumFee ?? null;
    const record: DumpExpenseRecord = {
      id: `dump-visit:${entry.id}`, date: day, truck: entry.truck, location: entry.name,
      enteredAt: entry.timestamp, departedAt, replaceUntil, amount: fee, assumedAmount: fee,
      status: fee === null ? 'minimum_missing' : 'assumed',
      window: !replaceUntil ? 'onsite' : now <= Date.parse(replaceUntil) ? 'open' : 'closed',
      actualExpenseId: null, transactionAt: entry.timestamp,
    };
    records.push(record); open.set(key, record);
  }
  const actuals = [...new Map(expenses.filter(expense => expense.kind === 'dump' && Date.parse(expense.transactionAt) <= now).map(expense => [expense.id, expense])).values()]
    .sort((a, b) => Date.parse(a.transactionAt) - Date.parse(b.transactionAt) || a.id.localeCompare(b.id));
  const matched = new Set<string>();
  for (const expense of actuals) {
    const time = Date.parse(expense.transactionAt);
    const candidates = records.filter(record => !record.actualExpenseId && truckKey(record.truck) === truckKey(expense.truck)
      && time >= Date.parse(record.enteredAt!) && (!record.replaceUntil || time <= Date.parse(record.replaceUntil))
      && (!expense.location.trim() || facilityKey(record.location, policy) === facilityKey(expense.location, policy)))
      .sort((a, b) => b.enteredAt!.localeCompare(a.enteredAt!));
    // A blank location is usable only with one eligible visit. One receipt can
    // replace one assumption; successive visits prefer the most recent entry.
    const record = expense.location.trim() || candidates.length === 1 ? candidates[0] : undefined;
    if (!record) continue;
    record.status = 'actual'; record.amount = expense.amount; record.actualExpenseId = expense.id;
    record.transactionAt = expense.transactionAt; matched.add(expense.id);
  }
  return [...records.filter(record => record.date === date), ...actuals.filter(expense => expense.date === date && !matched.has(expense.id)).map(expense => ({
    id: `dump-actual:${expense.id}`, date, truck: expense.truck.replace('#', ''), location: expense.location,
    enteredAt: null, departedAt: null, replaceUntil: null, amount: expense.amount, assumedAmount: null,
    status: 'actual' as const, window: null, actualExpenseId: expense.id, transactionAt: expense.transactionAt,
  }))].sort((a, b) => Date.parse(b.transactionAt) - Date.parse(a.transactionAt));
}
