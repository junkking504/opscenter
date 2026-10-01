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
 * visits remain owned by their appointment cards. HQ entry and exit evidence
 * stays one visit; an overnight visit is clipped to the visible operating day
 * while retaining its real timestamps for the duration label. */
export function scheduleOperationalStops(date: string, visits: FacilityVisit[]): ScheduleOperationalStop[] {
  return visits.flatMap(visit => {
    if (visit.kind !== 'geofence' || visit.conflict) return [];
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
    const startMinutes = spanningHqVisit ? Math.min(480, minute(endAt)) : minute(startAt);
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
