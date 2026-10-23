import {qualifiedGeofenceVisit, GEOFENCE_MINIMUM_DWELL_SECONDS} from './visit-tracking-agent';
import {GPS_MAX_POINT_GAP_MS} from './gps-presence-policy';
import { geofenceAlertLocation } from './linxup-geofence-alerts';
import { operationalLocationCodeAt } from './fleet-map';
import { truckLabel, type ScheduleOperationalStop } from '../desktop-ui/lib/schedule-contract';
import type { TruckGpsRoute } from '../desktop-ui/lib/gps-route-contract';

type FacilityVisit = {
  id: string;
  kind: 'geofence' | 'appointment';
  truck: string;
  name: string;
  facility?: string;
  resetLocation?: 'dump' | 'metal_yard' | null;
  enteredAt: string | null;
  departedAt: string | null;
  lastSeenAt: string;
  conflict?: boolean;
  geofenceDwellSeconds?: number;
  facilityPosition?: { latitude: number; longitude: number };
};

const day = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(value));
const minute = (value: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
};

/** Project positive facility evidence onto the dispatch timeline. Appointment
 * visits remain owned by their appointment cards. HQ entry and exit evidence
 * stays one visit; an overnight visit is clipped to the visible operating day
 * while retaining its real timestamps for the duration label. */
export function scheduleOperationalStops(date: string, visits: FacilityVisit[]): ScheduleOperationalStop[] {
  return visits.flatMap(visit => {
    if (!qualifiedGeofenceVisit(visit)) return [];
    const entered = visit.enteredAt && Number.isFinite(Date.parse(visit.enteredAt)) ? visit.enteredAt : null;
    const departed = visit.departedAt && Number.isFinite(Date.parse(visit.departedAt)) ? visit.departedAt : null;
    const observed = Number.isFinite(Date.parse(visit.lastSeenAt)) ? visit.lastSeenAt : entered || departed;
    if (!observed) return [];
    const positionCode = /warehouse|\bhq\b/i.test(visit.name) && visit.facilityPosition
      ? operationalLocationCodeAt(visit.facilityPosition)
      : null;
    const name = positionCode === 'NOHQ' || positionCode === 'BRHQ' ? positionCode : geofenceAlertLocation(visit.name);
    const hq = /^(?:NOHQ|BRHQ)$/i.test(name) || /warehouse/i.test(visit.facility || '');
    const enteredToday = Boolean(entered && day(entered) === date);
    const departedToday = Boolean(departed && day(departed) === date);
    const observedToday = day(observed) === date;
    const spanningHqVisit = hq && !enteredToday && (departedToday || (!departed && observedToday));
    if (!enteredToday && !departedToday && !spanningHqVisit) return [];
    const dump = visit.resetLocation === 'dump';
    const startAt = enteredToday ? entered! : departedToday ? departed! : observed;
    const endAt = departedToday ? departed! : observed;
    const startMinutes = spanningHqVisit ? Math.min(420, minute(endAt)) : minute(startAt);
    return [{
      id: visit.id,
      truck: truckLabel(visit.truck),
      name,
      facility: visit.facility || 'Geofenced location',
      kind: dump ? 'dump' as const : hq ? 'hq' as const : 'facility' as const,
      label: hq ? `${name} Visit` : dump ? 'Dump' : name,
      enteredAt: entered,
      departedAt: departed,
      observedThrough: observed,
      startMinutes,
      endMinutes: Math.max(startMinutes, minute(endAt)),
      ongoing: !departed,
    }];
  }).sort((a, b) => a.truck.localeCompare(b.truck, undefined, { numeric: true }) || a.startMinutes - b.startMinutes || a.id.localeCompare(b.id));
}

/** A recorded trip endpoint at HQ is positive presence evidence even when the
 * geofence transition feed omitted that truck. Pair an arrival with the next
 * departure to prove a stay of at least five minutes. Unpaired endpoints and
 * route coverage timestamps alone do not establish a visit. */
export function scheduleGpsHqStops(date: string, routes: TruckGpsRoute[]): ScheduleOperationalStop[] {
  const result: ScheduleOperationalStop[] = [];
  const add = (route: TruckGpsRoute, code: 'NOHQ' | 'BRHQ', enteredAt: string, departedAt: string | null, observedThrough: string) => {
    const duration = Date.parse(departedAt || observedThrough)-Date.parse(enteredAt);
    if (!Number.isFinite(duration) || duration < GEOFENCE_MINIMUM_DWELL_SECONDS*1000) return;
    const startMinutes = minute(enteredAt), endMinutes = Math.max(startMinutes, minute(departedAt || observedThrough));
    result.push({
      id: `gps-hq:${route.truck}:${code}:${enteredAt}:${departedAt || observedThrough}`,
      truck: truckLabel(route.truck), name: code, facility: 'Junk King warehouse', kind: 'hq', label: `${code} Visit`,
      enteredAt, departedAt, observedThrough, startMinutes, endMinutes, ongoing: !departedAt,
    });
  };
  for (const route of routes) {
    let open: { code: 'NOHQ' | 'BRHQ'; arrival: string } | null = null;
    for (const trip of [...(route.trips || [])].sort((a, b) => a.departure.localeCompare(b.departure))) {
      if (day(trip.departure) !== date) continue;
      const from = operationalLocationCodeAt(trip.from);
      const fromHq = from === 'NOHQ' || from === 'BRHQ' ? from : null;
      if (open && fromHq === open.code && Date.parse(trip.departure) >= Date.parse(open.arrival)) {
        add(route, open.code, open.arrival, trip.departure, trip.departure);
        open = null;
      } else if (fromHq) add(route, fromHq, trip.departure, trip.departure, trip.departure);
      const to = operationalLocationCodeAt(trip.to);
      open = to === 'NOHQ' || to === 'BRHQ' ? { code: to, arrival: trip.arrival } : null;
    }
    if (open) {
      let started: string | null = open.arrival, lastSeen = open.arrival;
      for (const point of [...route.points].sort((a,b)=>a.timestamp.localeCompare(b.timestamp))) {
        const stamp = Date.parse(point.timestamp);
        if (!Number.isFinite(stamp) || stamp < Date.parse(open.arrival) || stamp > Date.now()) continue;
        if (operationalLocationCodeAt(point) !== open.code) { started = null; continue; }
        if (!started || stamp-Date.parse(lastSeen) > GPS_MAX_POINT_GAP_MS) started = point.timestamp;
        lastSeen = point.timestamp;
      }
      if (started) add(route, open.code, started, null, lastSeen);
    }
  }
  return result.sort((a, b) => a.truck.localeCompare(b.truck, undefined, { numeric: true }) || a.startMinutes - b.startMinutes || a.id.localeCompare(b.id));
}

export function mergeScheduleOperationalStops(primary: ScheduleOperationalStop[], gps: ScheduleOperationalStop[]) {
  const overlaps = (a: ScheduleOperationalStop, b: ScheduleOperationalStop) => {
    if (a.truck !== b.truck || a.name !== b.name) return false;
    // Compare source intervals before operating-day clipping. An overnight HQ
    // stay contains the trip's origin even when their exit clocks differ.
    const interval = (stop: ScheduleOperationalStop) => {
      const start = Date.parse(stop.enteredAt || '');
      const end = Date.parse(stop.departedAt || stop.observedThrough || '');
      return Number.isFinite(start) && Number.isFinite(end) ? { start, end: Math.max(start,end) } : null;
    };
    const first = interval(a), second = interval(b);
    if (first && second) return first.start <= second.end + 120_000 && second.start <= first.end + 120_000;
    return a.startMinutes <= b.endMinutes + 2 && b.startMinutes <= a.endMinutes + 2;
  };
  return [...primary, ...gps.filter(candidate => !primary.some(stop => overlaps(stop, candidate)))]
    .sort((a, b) => a.truck.localeCompare(b.truck, undefined, { numeric: true }) || a.startMinutes - b.startMinutes || a.id.localeCompare(b.id));
}
