import { appointmentOnsiteTime } from './appointment-onsite-time';
import { currentGpsPresence, type PresenceTruck } from './schedule-gps-presence';
import { onsiteGpsMaxAge } from './parked-onsite-presence';
import { truckLabel, type ScheduleTruckVisit, type ScheduleTruckVisitGap } from '../desktop-ui/lib/schedule-contract';

export type { ScheduleTruckVisit, ScheduleTruckVisitGap } from '../desktop-ui/lib/schedule-contract';
type Job = Parameters<typeof currentGpsPresence>[0];
type Interval = { arrival?: string; departure?: string | null; departure_confirmed?: boolean; source_timestamps?: string[] };
type Visit = { appointment_id?: string; appt_id?: string; truck_number?: string; truck?: string; match_confidence?: string; pass_by_only?: boolean; first_arrival?: string; final_departure?: string; source_timestamps?: string[]; visit_intervals?: Interval[] };
type FacilityVisit = { kind?: string; truck: string; name: string; enteredAt: string | null; resetLocation?: 'dump' | 'metal_yard' | null; conflict?: boolean };

/** Display evidence only. Never alter booked assignments or visit accounting. */
export function scheduleTruckVisits(job: Job, visits: Visit[], trucks: PresenceTruck[], appointments: Job[], now = Date.now()): ScheduleTruckVisit[] {
  const matching = visits.filter(v => job.appointmentId && String(v.appointment_id || v.appt_id || '') === job.appointmentId && v.match_confidence === 'confirmed' && !v.pass_by_only);
  const result: ScheduleTruckVisit[] = [];
  for (const visit of matching) {
    const truck = truckLabel(String(visit.truck_number || visit.truck || ''));
    if (!/^Truck [1-9]\d*$/.test(truck)) continue;
    const intervals = visit.visit_intervals?.length ? visit.visit_intervals : [{arrival:visit.first_arrival,departure:visit.final_departure,source_timestamps:visit.source_timestamps}];
    for (const interval of intervals) {
      const start = Date.parse(interval.arrival || '');
      if (!Number.isFinite(start) || start > now) continue;
      const departure = interval.departure_confirmed === false ? null : interval.departure || null;
      const end = departure ? Date.parse(departure) : Math.max(start, ...(interval.source_timestamps || []).map(Date.parse).filter(t => Number.isFinite(t) && t >= start && t <= now));
      if (!Number.isFinite(end) || end < start || end > now) continue;
      result.push({truck,arrival:new Date(start).toISOString(),departure:departure ? new Date(end).toISOString() : null,observedThrough:new Date(end).toISOString()});
    }
  }
  // Qualify each truck independently: two crews may work the same appointment.
  for (const truck of trucks) {
    const name = truckLabel(truck.truck);
    const time = appointmentOnsiteTime({...job,truck:name}, matching, now);
    const presence = currentGpsPresence({...job,onsiteTime:time}, [truck], appointments, now);
    if (!presence?.current) continue;
    const existing = result.filter(v => v.truck === name && !v.departure && Date.parse(v.arrival) <= Date.parse(presence.observedAt) && Date.parse(v.observedThrough) >= Date.parse(presence.arrival)).sort((a,b)=>Date.parse(b.arrival)-Date.parse(a.arrival))[0];
    const active = existing || {truck:name,arrival:presence.arrival,departure:null,observedThrough:presence.observedAt};
    active.observedThrough = presence.observedAt;
    active.currentUntil = new Date(Date.parse(presence.observedAt) + onsiteGpsMaxAge(truck)).toISOString();
    if (!existing) result.push(active);
  }
  // Deduplicate overlapping observations without joining separate visits or trucks.
  const merged: ScheduleTruckVisit[] = [];
  for (const visit of result.sort((a,b)=>a.truck.localeCompare(b.truck) || Date.parse(a.arrival)-Date.parse(b.arrival))) {
    const previous = merged.at(-1);
    if (previous?.truck === visit.truck && Date.parse(visit.arrival) <= Date.parse(previous.observedThrough)) {
      if (Date.parse(visit.observedThrough) >= Date.parse(previous.observedThrough)) {
        previous.observedThrough = visit.observedThrough;
        previous.departure = visit.departure;
      }
      if (visit.currentUntil) previous.currentUntil = visit.currentUntil;
    } else merged.push({...visit});
  }
  return merged.filter(v => v.currentUntil || Date.parse(v.observedThrough) > Date.parse(v.arrival));
}

/** Connect separate visits to the same appointment without guessing why the
 * truck left. A dump label requires a positive dump-facility arrival inside
 * the gap; every other leave-and-return interval remains simply off site. */
export function scheduleTruckVisitGaps(visits: ScheduleTruckVisit[], facilityVisits: FacilityVisit[]): ScheduleTruckVisitGap[] {
  const byTruck = new Map<string, ScheduleTruckVisit[]>();
  for (const visit of visits) {
    const truck = truckLabel(visit.truck);
    const rows = byTruck.get(truck) || [];
    rows.push(visit);
    byTruck.set(truck, rows);
  }
  return [...byTruck.entries()].flatMap(([truck, rows]) => rows
    .sort((a,b)=>Date.parse(a.arrival)-Date.parse(b.arrival))
    .slice(0,-1)
    .flatMap((visit,index) => {
      const departedAt=visit.departure, returnedAt=rows[index+1].arrival;
      const departed=Date.parse(departedAt || ''), returned=Date.parse(returnedAt);
      if (!departedAt || !Number.isFinite(departed) || !Number.isFinite(returned) || returned<=departed) return [];
      const dump=facilityVisits
        .filter(candidate=>candidate.kind==='geofence' && candidate.resetLocation==='dump' && !candidate.conflict && truckLabel(candidate.truck)===truck && Number.isFinite(Date.parse(candidate.enteredAt || '')))
        .sort((a,b)=>Date.parse(a.enteredAt!)-Date.parse(b.enteredAt!))
        .find(candidate=>Date.parse(candidate.enteredAt!)>=departed && Date.parse(candidate.enteredAt!)<=returned);
      return [{truck,departedAt,returnedAt,kind:dump?'dump' as const:'off_site' as const,
        ...(dump ? {facilityName:dump.name,facilityEnteredAt:dump.enteredAt!} : {})}];
    }));
}
