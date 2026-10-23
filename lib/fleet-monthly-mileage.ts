import { chicagoDateKey, addDays } from './chicago-date';
import { truckNumber } from './junkware-trucks';

type RecordValue = Record<string, unknown>;
export type MileageArchive = { date: string; payload: RecordValue | null };
export type MonthlyTruckMileage = {
  month: string; throughDate: string; expectedDays: number; archiveDays: number;
  tripDays: number; recordedMiles: number | null; totalMiles: number | null;
  status: 'partial' | 'unavailable'; latestTripAt: string | null;
  retrievedAt: string | null; excludedTrips: number; duplicateTrips: number;
};
const records = (value: unknown): RecordValue[] => Array.isArray(value)
  ? value.filter((row): row is RecordValue => Boolean(row) && typeof row === 'object' && !Array.isArray(row)) : [];
const numeric = (value: unknown): number | null => {
  if (value == null || value === '' || typeof value === 'boolean' || !['number', 'string'].includes(typeof value)) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
};
export function mileageMonthWindow(selectedDate: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) || new Date(`${selectedDate}T12:00:00Z`).toISOString().slice(0, 10) !== selectedDate) throw new Error('Invalid mileage date');
  const month = selectedDate.slice(0, 7), start = `${month}-01`;
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0, 12)).toISOString().slice(0, 10);
  // Past selections describe their entire month; the current month is month-to-date.
  const throughDate = end < chicagoDateKey(now) ? end : chicagoDateKey(now);
  const dates: string[] = [];
  for (let day = start; day <= throughDate; day = addDays(day, 1)) dates.push(day);
  return { month, throughDate: throughDate < start ? start : throughDate, dates };
}

/** Saved closed provider trips only. Neither score defaults nor odometers prove distance. */
export function aggregateMonthlyMileage(selectedDate: string, trucks: string[], archives: MileageArchive[], now = new Date()): Record<string, MonthlyTruckMileage> {
  const window = mileageMonthWindow(selectedDate, now), dates = new Set(window.dates);
  const result: Record<string, MonthlyTruckMileage> = {};
  const names = new Map(trucks.map(name => [truckNumber(name), name]));
  const daySets = new Map<string, Set<string>>();
  const candidates = new Map<string, Array<{ truck: string; date: string; miles: number; start: number; end: number; retrievedAt: string | null }>>();
  for (const name of trucks) result[name] = {month: window.month, throughDate: window.throughDate, expectedDays: dates.size, archiveDays: 0, tripDays: 0, recordedMiles: null, totalMiles: null, status: 'unavailable', latestTripAt: null, retrievedAt: null, excludedTrips: 0, duplicateTrips: 0};
  const seenDates = new Set<string>();
  for (const archive of archives) {
    const raw = archive.payload;
    if (!dates.has(archive.date) || seenDates.has(archive.date) || !raw || raw.date !== archive.date || raw.timezone !== 'America/Chicago' || !Array.isArray(raw.trips)) continue;
    seenDates.add(archive.date);
    const mapping = new Map<string, Set<number>>();
    for (const point of records(raw.points)) {
      const number = truckNumber(point.truck_number), tracker = String(point.tracker_id || '');
      if (number && tracker) mapping.set(tracker, new Set([...(mapping.get(tracker) || []), number]));
    }
    for (const row of Object.values(result)) row.archiveDays++;
    const collected = typeof raw.collection_timestamp === 'string' ? Date.parse(raw.collection_timestamp) : NaN;
    const retrievedAt = Number.isFinite(collected) && collected <= now.getTime() ? new Date(collected).toISOString() : null;
    for (const trip of records(raw.trips)) {
      const tracker = String(trip.deviceUUID || '');
      const labels = [trip.truck_number, trip.personName, trip.driverName, trip.truck].map(truckNumber).filter((n): n is number => n !== null);
      const identities = new Set([...labels, ...(mapping.get(tracker) || [])]);
      const affected = [...identities].map(n => names.get(n)).filter((name): name is string => Boolean(name));
      if (identities.size !== 1) { for (const name of affected) result[name].excludedTrips++; continue; }
      const name = affected[0];
      if (!name) continue;
      const row = result[name], start = numeric(trip.startDateTime), end = numeric(trip.endDateTime);
      // Detailed miles are the collector's authoritative unit; rounded miles are fallback only.
      const miles = numeric(trip.distanceMilesDetailed ?? trip.distanceMiles);
      if (start === null || end === null || start <= 0 || end <= start || end > now.getTime() || miles === null ||
          !Number.isFinite(new Date(start).getTime()) || !Number.isFinite(new Date(end).getTime()) ||
          chicagoDateKey(new Date(start)) !== archive.date || chicagoDateKey(new Date(end)) !== archive.date ||
          miles / (end - start) * 3600000 > 100) { row.excludedTrips++; continue; }
      // Provider trip UUIDs can change between reads. Truck/time is the stable observation key.
      const key = `${name}:${start}:${end}`;
      candidates.set(key, [...(candidates.get(key) || []), {truck: name, date: archive.date, miles, start, end, retrievedAt}]);
    }
  }
  const groups = [...candidates.values()];
  const overlapping = new Set<string>();
  const ordered = groups.map(group => group[0]).sort((a,b) => a.start-b.start);
  for (let i=0; i<ordered.length; i++) for (let j=i+1; j<ordered.length && ordered[j].start<ordered[i].end; j++) {
    if (ordered[i].truck !== ordered[j].truck) continue;
    overlapping.add(`${ordered[i].truck}:${ordered[i].start}:${ordered[i].end}`);
    overlapping.add(`${ordered[j].truck}:${ordered[j].start}:${ordered[j].end}`);
  }
  for (const group of groups) {
    const first = group[0], row = result[first.truck];
    if (overlapping.has(`${first.truck}:${first.start}:${first.end}`) || group.some(trip => trip.miles !== first.miles)) { row.excludedTrips += group.length; continue; }
    row.duplicateTrips += group.length - 1;
    row.recordedMiles = (row.recordedMiles ?? 0) + first.miles;
    daySets.set(first.truck, new Set([...(daySets.get(first.truck) || []), first.date]));
    const at = new Date(first.end).toISOString();
    if (!row.latestTripAt || at > row.latestTripAt) row.latestTripAt = at;
    for (const trip of group) if (trip.retrievedAt && (!row.retrievedAt || trip.retrievedAt > row.retrievedAt)) row.retrievedAt = trip.retrievedAt;
  }
  for (const [name, row] of Object.entries(result)) {
    row.tripDays = daySets.get(name)?.size || 0;
    if (row.recordedMiles !== null) { row.recordedMiles = Math.round(row.recordedMiles * 100) / 100; row.status = 'partial'; }
    // The archive validates point syntax, not continuous tracker/trip coverage.
    // Even a file for every day cannot establish a full month or a zero-mile day.
  }
  return result;
}

export function sixMonthMileageAverage(months: MonthlyTruckMileage[]): number | null {
  const keys = months.map(row => row.month).sort();
  if (keys.length !== 6 || new Set(keys).size !== 6 || months.some(row => row.totalMiles === null || !Number.isFinite(row.totalMiles) || row.totalMiles < 0)) return null;
  for (let i = 1; i < keys.length; i++) {
    const next = new Date(`${keys[i - 1]}-01T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
    if (next.toISOString().slice(0, 7) !== keys[i]) return null;
  }
  return Math.round(months.reduce((sum, row) => sum + row.totalMiles!, 0) / 6 * 100) / 100;
}
