import { chicagoDateKey } from './report-dates';
import { operationalLocationCodeAt, type FleetTruckMapRecord } from './fleet-map';
import { truckGpsStatus } from './truck-gps-status';

/** Daily evidence only. Missing telemetry never proves that an uninspected truck is in use. */
export function fleetInspectionStatus(date: string, submitted: boolean, inspectionsAvailable: boolean, source: FleetTruckMapRecord | undefined, now = Date.now()): 'Submitted' | 'Missing' | 'In Use, No Inspection' | 'Unknown' {
  if (!inspectionsAvailable) return 'Unknown';
  if (!source || !source.hasCoordinates || !source.lastGpsUpdate || !Number.isFinite(Date.parse(source.lastGpsUpdate)) || chicagoDateKey(new Date(source.lastGpsUpdate)) !== date) return 'Unknown';
  const today = date === chicagoDateKey(new Date(now));
  if (today && truckGpsStatus(source, now).stale) return 'Unknown';
  if (submitted) return 'Submitted';
  const leftHQ = source.routePoints.some(point => {
    const stamp = Date.parse(point.timestamp);
    if (!Number.isFinite(stamp) || stamp > now || chicagoDateKey(new Date(stamp)) !== date) return false;
    const code = operationalLocationCodeAt(point);
    return code !== 'NOHQ' && code !== 'BRHQ';
  });
  const assignmentStarted = source.relatedAppointments.some(row => /^(in[ _-]?progress|started|on[ _-]?site|at[ _-]?job)$/i.test(row.status.trim()));
  return leftHQ || assignmentStarted ? 'In Use, No Inspection' : 'Missing';
}
