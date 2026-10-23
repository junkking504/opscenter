import {appointmentVisitPin, ambiguousVisitPin, type VisitPinJob} from './appointment-visit-pin';
import { onsiteGpsDwell, onsiteGpsMaxAge, type ParkedPoint } from './parked-onsite-presence';
import type { Coordinates } from './job-route-proximity';
import { truckLabel } from '../desktop-ui/lib/schedule-contract';
import { parkedTruckObservation } from './truck-gps-status';
import { gpsDistanceMeters as distance, gpsObservedPresence, validGpsCoordinates, GPS_SITE_RADIUS_METERS } from './gps-presence-policy';

type PresenceJob = VisitPinJob & { truck?: string; appointmentId: string; location?: Coordinates | null; status?: string; appointmentStartMinutes?: number | null; appointmentEndMinutes?: number | null; onsiteTime?: {departure?: string | null} };
export type PresenceTruck = { truck: string; lastGpsUpdate: string | null; latitude?: number | null; longitude?: number | null; speed?: number | null; ignition?: string | null; routePoints?: ParkedPoint[] };
// Use the same coordinate and live freshness rules for inferred arrivals and open
// ledger visits. A fresh timestamp alone does not locate a truck at a job.
export function gpsPositionAtAppointment(location: Coordinates | null | undefined, truck: PresenceTruck, now = Date.now()) {
  const stamp = Date.parse(truck.lastGpsUpdate || '');
  if (!location || !validGpsCoordinates(location) || !validGpsCoordinates(truck) || !Number.isFinite(stamp) || stamp > now) return undefined;
  return { stamp, inside: distance(location, truck) <= GPS_SITE_RADIUS_METERS, current: now - stamp <= onsiteGpsMaxAge(truck) };
}

// A parked provider report can answer the narrower dispatch question "where
// was the assigned truck reported?" even when sparse telemetry cannot prove
// continuous dwell. Keep this separate from currentGpsPresence so it never
// creates an arrival time, on-site duration, map beacon or visit interval.
export function currentGpsJobLocation(job: PresenceJob, trucks: PresenceTruck[], appointments: PresenceJob[], now = Date.now()) {
  const pin=appointmentVisitPin(job), location=pin?.location;
  if (!location || ambiguousVisitPin(job,appointments) || /cancel/i.test(job.status || '')) return undefined;
  const assignedTruck = truckLabel(job.truck || '');
  if (assignedTruck === 'Unassigned') return undefined;
  const candidates = trucks.flatMap(truck => {
    if (truckLabel(truck.truck) !== assignedTruck || !parkedTruckObservation(truck)) return [];
    const observation = gpsPositionAtAppointment(location, truck, now);
    if (!observation?.inside || !observation.current) return [];
    if (Date.parse(job.onsiteTime?.departure || '') >= observation.stamp) return [];
    const position = { latitude: truck.latitude!, longitude: truck.longitude! };
    const nearby = appointments.filter(row => appointmentVisitPin(row) && !/cancel/i.test(row.status || '')
      && truckLabel(row.truck || '') === assignedTruck
      && distance(position, appointmentVisitPin(row)!.location) <= GPS_SITE_RADIUS_METERS);
    if (nearby.length !== 1 || nearby[0].appointmentId !== job.appointmentId) return [];
    return [{ ...(pin!.approximate ? {approximate:true} : {}), truck: assignedTruck, observedAt: truck.lastGpsUpdate!, parked: true as const }];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

// Current Schedule data can lead the slower visit ledger after a dispatch move.
// A single fresh coordinate at one eligible appointment establishes presence.
// Visit-duration accounting remains in the separately confirmed visit ledger.
export function currentGpsPresence(job: PresenceJob, trucks: PresenceTruck[], appointments: PresenceJob[], now = Date.now()) {
  const eligible = (row: PresenceJob) => appointmentVisitPin(row) && !/cancel|completed|closed/i.test(row.status || '');
  const pin=appointmentVisitPin(job), location=pin?.location;
  if (!location || ambiguousVisitPin(job,appointments) || /cancel|completed|closed/i.test(job.status || '')) return undefined;
  const candidates = trucks.flatMap(truck => {
    const observation = gpsPositionAtAppointment(location, truck, now);
    if (!observation?.inside || now - observation.stamp > 12 * 3600_000) return [];
    const { stamp } = observation;
    const departedAt = Date.parse(job.onsiteTime?.departure || '');
    const since = Number.isFinite(departedAt) ? departedAt : -Infinity;
    const dwell = onsiteGpsDwell(location, truck, truck.routePoints || [], since)
      || gpsObservedPresence(location, truck, truck.routePoints || [], since);
    if (Date.parse(job.onsiteTime?.departure || '') >= stamp) return [];
    const position = { latitude: truck.latitude!, longitude: truck.longitude! };
    if (!eligible(job)) return [];
    const nearby = appointments.filter(row => eligible(row) && distance(position, appointmentVisitPin(row)!.location) <= GPS_SITE_RADIUS_METERS);
    if (nearby.length !== 1 || nearby[0].appointmentId !== job.appointmentId) return [];
    return [{ ...(pin!.approximate ? {approximate:true} : {}), truck: truckLabel(truck.truck), arrival: new Date(dwell?.arrival ?? stamp).toISOString(), observedAt: truck.lastGpsUpdate!, current: observation.current, parked: parkedTruckObservation(truck) }];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}
