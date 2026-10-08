import type { FleetMileage } from './fleet-service-plan';

export type InspectionMileage = { truck: string; odometer: string; startedAt: string; receivedAt: string; inspectionDate: string; deviceId: string; requestId: string };
type ServiceMileage = { truck: string; status: string; serviceDate: string; odometer: number | null };
const truckKey = (value: string) => value.match(/\d+/)?.[0];
const plausible = (value: number, prior: number, elapsed: number) => value >= prior && value - prior <= Math.max(500, elapsed / 86400000 * 1500);

/** Inspection mileage is an observation, never a synthesized present-day odometer. */
export function reconcileFleetMileage(truck: string, tracking: FleetMileage, reports: InspectionMileage[], services: ServiceMileage[], now = Date.now()): FleetMileage {
  if (!truckKey(truck)) return tracking;
  const rows = reports.filter(r => truckKey(r.truck) === truckKey(truck)).sort((a,b) => b.startedAt.localeCompare(a.startedAt) || b.receivedAt.localeCompare(a.receivedAt));
  if (!rows.length) return tracking;
  const latest = rows[0], previous = rows[1], value = Number(latest.odometer), at = Date.parse(latest.startedAt);
  const service = services.filter(r => truckKey(r.truck) === truckKey(truck) && r.status === 'completed' && r.odometer !== null && r.serviceDate <= latest.inspectionDate).sort((a,b) => b.serviceDate.localeCompare(a.serviceDate) || b.odometer! - a.odometer!)[0];
  let reason = '';
  if (!/^\d{1,8}$/.test(latest.odometer) || value <= 0 || !Number.isFinite(at) || at > now || !Number.isFinite(Date.parse(latest.receivedAt)) || Date.parse(latest.receivedAt) > now) reason = 'Inspection mileage or date needs correction.';
  else if (service && value < service.odometer!) reason = 'Inspection mileage is below recorded service mileage.';
  else if (previous && (!/^\d{1,8}$/.test(previous.odometer) || Number(previous.odometer) <= 0 || !Number.isFinite(Date.parse(previous.startedAt)) || !plausible(value, Number(previous.odometer), at - Date.parse(previous.startedAt)))) reason = 'Inspection readings disagree. Check the physical odometer.';

  else if (!previous && service && !plausible(value, service.odometer!, at - Date.parse(service.serviceDate + 'T00:00:00Z'))) reason = 'Inspection mileage does not reconcile with service history.';
  return { value: reason ? null : value, source: 'inspection', reportedAt: latest.startedAt, retrievedAt: latest.receivedAt, estimated: null, conflicting: Boolean(reason), duplicate: false,
    inspectionDate: latest.inspectionDate,
    inspectionHref: `/fleet-inspections?date=${latest.inspectionDate}&report=${encodeURIComponent(`${latest.deviceId}:${latest.requestId}`)}`,
    note: reason || 'Visual inspection odometer is the baseline; LinxUp digital odometer is reference only.',
    tracking: { value: tracking.value, source: tracking.source, reportedAt: tracking.reportedAt },
  };
}
