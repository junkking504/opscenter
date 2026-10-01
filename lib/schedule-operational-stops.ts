import { geofenceAlertLocation } from './linxup-geofence-alerts';
import { operationalLocationCodeAt } from './fleet-map';
import { truckLabel, type ScheduleOperationalStop } from '../desktop-ui/lib/schedule-contract';

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
 * visits remain owned by their appointment cards. An overnight HQ presence is
 * represented by its current-day departure, not a fabricated all-day stop. */
export function scheduleOperationalStops(date: string, visits: FacilityVisit[]): ScheduleOperationalStop[] {
  return visits.flatMap(visit => {
    if (visit.kind !== 'geofence' || visit.conflict) return [];
    const entered = visit.enteredAt && Number.isFinite(Date.parse(visit.enteredAt)) ? visit.enteredAt : null;
    const departed = visit.departedAt && Number.isFinite(Date.parse(visit.departedAt)) ? visit.departedAt : null;
    const observed = Number.isFinite(Date.parse(visit.lastSeenAt)) ? visit.lastSeenAt : entered || departed;
    if (!observed) return [];
    const enteredToday = Boolean(entered && day(entered) === date);
    const departedToday = Boolean(departed && day(departed) === date);
    if (!enteredToday && !departedToday) return [];
    const positionCode = /warehouse|\bhq\b/i.test(visit.name) && visit.facilityPosition
      ? operationalLocationCodeAt(visit.facilityPosition)
      : null;
    const name = positionCode === 'NOHQ' || positionCode === 'BRHQ' ? positionCode : geofenceAlertLocation(visit.name);
    const hq = /^(?:NOHQ|BRHQ)$/i.test(name) || /warehouse/i.test(visit.facility || '');
    const dump = visit.resetLocation === 'dump';
    const departureOnly = !enteredToday && departedToday;
    const startAt = departureOnly ? departed! : entered!;
    const endAt = departureOnly ? departed! : departedToday ? departed! : observed;
    return [{
      id: visit.id,
      truck: truckLabel(visit.truck),
      name,
      facility: visit.facility || 'Geofenced location',
      kind: departureOnly ? 'departure' as const : dump ? 'dump' as const : hq ? 'hq' as const : 'facility' as const,
      label: departureOnly ? `Left ${name}` : dump ? 'Dump' : name,
      enteredAt: entered,
      departedAt: departed,
      observedThrough: observed,
      startMinutes: minute(startAt),
      endMinutes: Math.max(minute(startAt), minute(endAt)),
      ongoing: enteredToday && !departed,
    }];
  }).sort((a, b) => a.truck.localeCompare(b.truck, undefined, { numeric: true }) || a.startMinutes - b.startMinutes || a.id.localeCompare(b.id));
}
