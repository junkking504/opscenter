import { chicagoDateKey } from './chicago-date';
import fs from 'node:fs';
import path from 'node:path';
import { aggregateMonthlyMileage, mileageMonthWindow, type MileageArchive } from './fleet-monthly-mileage';

const cache = new Map<string, { signature: string; archive: MileageArchive }>();
export function readMonthlyTruckMileage(date: string, trucks: string[], now = new Date()) {
  const root = process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), 'data');
  const archives = mileageMonthWindow(date, now).dates.map(day => {
    const normalized = path.join(root, 'history', 'linxup', `linxup_location_${day}.json`);
    const file = fs.existsSync(normalized) ? normalized : path.join(root, 'history', 'linxup', `linxup_${day}_raw.json`);
    try {
      const stat = fs.statSync(file), signature = `${stat.mtimeMs}:${stat.size}`, prior = cache.get(file);
      if (prior?.signature === signature) return prior.archive;
      let raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (file !== normalized) {
        const window = raw.window, response = raw.responses?.trips;
        const from = window?.from_ms, to = window?.to_ms;
        if (window?.timezone !== 'America/Chicago' || !Number.isFinite(from) || !Number.isFinite(to) || to < from ||
            !Number.isFinite(new Date(from).getTime()) || !Number.isFinite(new Date(to).getTime()) ||
            chicagoDateKey(new Date(from)) !== day || chicagoDateKey(new Date(to)) !== day ||
            response?.responseType !== 'Success' || !Array.isArray(response.data?.trips)) return {date: day, payload: null};
        raw = {date: day, timezone: window.timezone, collection_timestamp: raw.retrieved_at, trips: response.data.trips, points: []};
      }
      // Cache only fields needed here; never retain customer locations or full telemetry.
      const archive: MileageArchive = {date: day, payload: {
        date: raw.date, timezone: raw.timezone, collection_timestamp: raw.collection_timestamp,
        trips: Array.isArray(raw.trips) ? raw.trips.map((t: Record<string, unknown>) => Object.fromEntries(['truck_number','personName','driverName','truck','deviceUUID','startDateTime','endDateTime','distanceMilesDetailed','distanceMiles'].map(k => [k, t[k]]))) : null,
        points: Array.isArray(raw.points) ? [...new Map(raw.points.map((p: Record<string, unknown>) => [`${p.tracker_id}:${p.truck_number}`, {tracker_id: p.tracker_id, truck_number: p.truck_number}])).values()] : [],
      }};
      cache.set(file, {signature, archive});
      while (cache.size > 190) cache.delete(cache.keys().next().value!);
      return archive;
    } catch { return {date: day, payload: null}; }
  });
  return aggregateMonthlyMileage(date, trucks, archives, now);
}
