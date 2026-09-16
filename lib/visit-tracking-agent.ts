import {gpsDistanceMeters,validGpsCoordinates,GPS_MAX_POINT_GAP_MS} from './gps-presence-policy';
import {createHash} from 'node:crypto';

export const VISIT_TRACKING_AGENT = 'visit-tracking' as const;
export type VisitEvidence = 'native_geofence' | 'live_position' | 'later_facility' | 'later_position' | 'confirmed_appointment' | 'operational_confirmation';
export type TrackedVisit = {
  agentId: typeof VISIT_TRACKING_AGENT;
  id: string; kind: 'geofence' | 'appointment'; truck: string; name: string;
  enteredAt: string | null; departedAt: string | null; lastSeenAt: string;
  firstObservedAt: string; nativeEntryIds?: string[]; positionEntryId?: string;
  entryIds: string[]; arrivalSource: VisitEvidence; departureSource: VisitEvidence | null;
  departureBounds: {after: string; by: string} | null;
  durationSeconds: number | null; facility?: string; resetLocation?: 'dump' | 'metal_yard' | null;
  appointmentId?: string; jobNumber?: string; conflict?: boolean; supersededAt?: string; facilityPosition?: {latitude:number;longitude:number};
};
export type GeofenceTransition = {
  id: string; truck: string; name: string; timestamp: string;
  facility: string; resetLocation: 'dump' | 'metal_yard' | null;
  type: 'entry' | 'exit' | 'position' | 'coordinate'; latitude?: number; longitude?: number;
};
const visitDayFormatter = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Chicago'});
export const visitDay = (stamp: string) => visitDayFormatter.format(new Date(stamp));

// Names are provider facility identities. Only known distinct disposal/warehouse
// facilities reconcile departures; an arbitrary or overlapping named zone cannot.
const knownFacility = (event: {facility?: string}) => !!event.facility && event.facility !== 'Geofenced area';
const facilityKey = (name: string) => {
  if (/gentilly|^GL$/i.test(name)) return 'gentilly';
  if (/river\s*birch|^RBL$/i.test(name)) return 'river-birch';
  if (/stranco|^STS$/i.test(name)) return 'stranco';
  if (/green meadow|^GMTS$/i.test(name)) return 'green-meadow';
  return name.trim().toLowerCase();
};

/** Deterministic, read-only operational agent. It owns visit state and evidence,
 * never unloads, expenses, appointment closeouts, network requests or messages.
 * Historical observations replay in source time, so collection retries/reordering
 * have no effects. A missing geofence never establishes a departure.
 */
export function trackGeofenceVisits(date: string, transitions: GeofenceTransition[], now = Date.now()): TrackedVisit[] {
  const events = [...new Map(transitions.filter(event => Number.isFinite(Date.parse(event.timestamp)) && Date.parse(event.timestamp) <= now)
    .map(event => [`${event.type}:${event.id}`, event])).values()]
    .sort((a,b) => a.timestamp.localeCompare(b.timestamp) || ({entry:0,exit:1,position:2,coordinate:3}[a.type] - {entry:0,exit:1,position:2,coordinate:3}[b.type]));
  const active = new Map<string, TrackedVisit>(), completed: TrackedVisit[] = [];
  const outside = new Map<string,{first:number;last:number}>();
  for (const event of events) {
    if (event.type === 'coordinate') {
      if (!validGpsCoordinates(event)) continue;
      for (const [activeKey, visit] of active) {
        const stamp=Date.parse(event.timestamp);
        if (visit.truck !== event.truck || !visit.facilityPosition || stamp <= Date.parse(visit.lastSeenAt)) continue;
        // Facility boundaries are unknown here: use a conservative five-kilometre
        // buffer plus corroboration, never a single fix just beyond an entrance.
        if (gpsDistanceMeters(visit.facilityPosition,event) <= 5000) {outside.delete(activeKey);continue;}
        const prior=outside.get(activeKey);
        const first=prior && stamp-prior.last <= GPS_MAX_POINT_GAP_MS ? prior.first : stamp;
        outside.set(activeKey,{first,last:stamp});
        if (stamp-first < 60_000) continue;
        completed.push({...visit,departedAt:new Date(first).toISOString(),departureSource:'later_position',departureBounds:{after:visit.lastSeenAt,by:new Date(first).toISOString()},durationSeconds:null});
        active.delete(activeKey);outside.delete(activeKey);
      }
      continue;
    }
    const key = JSON.stringify([event.truck, facilityKey(event.name)]);
    if (event.type === 'exit') {
      const visit = active.get(key);
      active.delete(key);outside.delete(key);
      // A native exit after a positively observed different facility conflicts
      // with the bounded departure. Keep one visit and surface the contradiction.
      const inferred = !visit && [...completed].reverse().find(candidate=>candidate.truck === event.truck && facilityKey(candidate.name) === facilityKey(event.name) && ['later_facility','later_position'].includes(candidate.departureSource || ''));
      if (inferred) { inferred.conflict = true; continue; }
      const enteredAt = visit?.enteredAt || null;
      completed.push({...visit, agentId:VISIT_TRACKING_AGENT, kind:'geofence',
        id:visit?.id || event.id.replace('linxup-geofence-', 'linxup-geofence-exit-'),
        truck:event.truck,name:event.name,facility:event.facility,resetLocation:event.resetLocation,
        enteredAt,departedAt:event.timestamp,lastSeenAt:visit?.lastSeenAt || event.timestamp,
        firstObservedAt:visit?.firstObservedAt || event.timestamp,entryIds:visit?.entryIds || [],arrivalSource:visit?.arrivalSource || 'native_geofence',
        departureSource:'native_geofence',departureBounds:null,
        durationSeconds:enteredAt ? (Date.parse(event.timestamp)-Date.parse(enteredAt))/1000 : null});
      continue;
    }
    if (knownFacility(event)) {
      for (const [otherKey, visit] of active) {
        const gap = Date.parse(event.timestamp)-Date.parse(visit.lastSeenAt);
        if (otherKey === key || visit.truck !== event.truck || !knownFacility(visit) || gap <= 0) continue;
        completed.push({...visit,departedAt:event.timestamp,departureSource:'later_facility',
          departureBounds:{after:visit.lastSeenAt,by:event.timestamp},durationSeconds:null});
        active.delete(otherKey);outside.delete(otherKey);
      }
    }
    outside.delete(key);
    const facilityPosition=validGpsCoordinates(event) ? {latitude:event.latitude,longitude:event.longitude} : undefined;
    const previous = active.get(key);
    if (previous) {
      // Repeated live positions extend presence. A native entry supplements a
      // V3 arrival; two distinct native entries without exit remain ambiguous.
      const ambiguous = event.type === 'entry' && !!previous.nativeEntryIds?.length;
      active.set(key,{...previous,facilityPosition:facilityPosition || previous.facilityPosition,enteredAt:ambiguous ? null : previous.enteredAt,
        nativeEntryIds:event.type === 'entry' ? [...(previous.nativeEntryIds || []),event.id] : previous.nativeEntryIds,
        lastSeenAt:event.timestamp,positionEntryId:previous.positionEntryId || (event.type === 'position' ? event.id : undefined),
        entryIds:event.type === 'entry' || event.type === 'position' && !previous.positionEntryId ? [...new Set([...previous.entryIds,event.id])] : previous.entryIds});
    } else {
      active.set(key,{agentId:VISIT_TRACKING_AGENT,id:event.id,kind:'geofence',truck:event.truck,name:event.name,
        facility:event.facility,facilityPosition,resetLocation:event.resetLocation,enteredAt:event.timestamp,departedAt:null,lastSeenAt:event.timestamp,
        firstObservedAt:event.timestamp,positionEntryId:event.type === 'position' ? event.id : undefined,nativeEntryIds:event.type === 'entry' ? [event.id] : [],entryIds:[event.id],arrivalSource:event.type === 'entry' ? 'native_geofence' : 'live_position',
        departureSource:null,departureBounds:null,durationSeconds:null});
    }
  }
  return [...completed,...active.values()].filter(visit => visitDay(visit.departedAt || visit.enteredAt || visit.lastSeenAt) === date)
    .sort((a,b) => (b.departedAt || b.enteredAt || b.lastSeenAt).localeCompare(a.departedAt || a.enteredAt || a.lastSeenAt));
}

export type AppointmentVisitSource = {
  appointment_id?: string; appt_id?: string; jk_number?: string; job_id?: string;
  truck_number?: string | number; truck?: string; match_confidence?: string; pass_by_only?: boolean;
  first_arrival?: string; final_departure?: string; visit_count?: number; source_timestamps?: string[];
  visit_intervals?: {arrival?: string; departure?: string | null; departure_confirmed?: boolean; source_timestamps?: string[]}[];
  operational_confirmation?: boolean;
};

/** Strict adapter for the existing confirmed appointment collector. Current
 * assignments, facility sightings and pass-bys cannot manufacture a job visit.
 * A closed interval supersedes its stale arrival revision; incompatible closed
 * intervals remain conflicts. Returns are separate identities keyed by arrival.
 */
export function trackAppointmentVisits(date: string, visits: AppointmentVisitSource[], now = Date.now()): TrackedVisit[] {
  const candidates = new Map<string, TrackedVisit>();
  for (const visit of visits) {
    if (visit.match_confidence !== 'confirmed' || visit.pass_by_only) continue;
    const reference = String(visit.jk_number || visit.job_id || '').toUpperCase();
    const truck = String(visit.truck_number || visit.truck || '').match(/\d+/)?.[0]?.replace(/^0+/, '') || '';
    const appointment = String(visit.appointment_id || visit.appt_id || '');
    if (!/^JK\d+$/.test(reference) || !truck || !appointment) continue;
    const intervals = visit.visit_intervals?.length ? visit.visit_intervals : visit.visit_count === 1 ? [{arrival:visit.first_arrival,departure:visit.final_departure,departure_confirmed:undefined,source_timestamps:visit.source_timestamps}] : [];
    for (const interval of intervals) {
      const startMs = Date.parse(interval.arrival || ''), endMs = Date.parse(interval.departure || '');
      if (!Number.isFinite(startMs) || startMs > now) continue;
      const start = new Date(startMs).toISOString();
      const end = interval.departure_confirmed !== false && Number.isFinite(endMs) && (endMs > startMs || interval.departure_confirmed === true && endMs === startMs) && endMs <= now ? new Date(endMs).toISOString() : null;
      const key = JSON.stringify([appointment,reference,truck,start]), previous = candidates.get(key);
      const lastSeen = Math.max(startMs, ...[...(interval.source_timestamps || []), ...(intervals.length === 1 ? visit.source_timestamps || [] : []), previous?.lastSeenAt || '']
        .map(stamp=>Date.parse(stamp)).filter(stamp=>Number.isFinite(stamp) && stamp >= startMs && stamp <= now && (!end || stamp <= Date.parse(end))));
      const conflict = !!previous?.conflict || !!previous?.departedAt && !!end && previous.departedAt !== end;
      const departedAt = end || previous?.departedAt || null;
      const operational = !!visit.operational_confirmation || previous?.arrivalSource === 'operational_confirmation';
      const source = operational ? 'operational_confirmation' : 'confirmed_appointment';
      candidates.set(key,{agentId:VISIT_TRACKING_AGENT,id:`appointment-visit-${createHash('sha256').update(key).digest('hex').slice(0,24)}`,
        kind:'appointment',truck:`Truck ${truck}`,name:reference,appointmentId:appointment,jobNumber:reference,
        firstObservedAt:start,enteredAt:start,departedAt:conflict ? null : departedAt,lastSeenAt:new Date(lastSeen).toISOString(),entryIds:[],
        arrivalSource:source,departureSource:!conflict && departedAt ? source : null,departureBounds:null,conflict,
        durationSeconds:!conflict && !operational && departedAt ? (Date.parse(departedAt)-startMs)/1000 : null});
    }
  }
  return [...candidates.values()].filter(visit => visitDay(visit.departedAt || visit.enteredAt!) === date);
}
