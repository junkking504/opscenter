import { appointmentOnsiteTime } from './appointment-onsite-time';
import fs from 'node:fs';
import path from 'node:path';
import { withAppointmentVisitConfirmations } from '@/lib/appointment-visit-confirmations';
import { truckLabel } from '../desktop-ui/lib/schedule-contract';
import type { AnyRecord } from '@/lib/opsData';
import { gpsPositionAtAppointment, type PresenceTruck } from './schedule-gps-presence';
import type { Coordinates } from './job-route-proximity';

// Ledger collection freshness is separate from the truck observation's
// coordinates and live freshness window.
const LIVE_GPS_MAX_AGE_MS = 10 * 60_000;

export function readScheduleVisits(date: string): { visits: AnyRecord[]; observedAt: string } {
  const directory = process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), 'data');
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(directory, 'history', 'linxup', 'appointment_visits', `linxup_appointment_visits_${date}.json`), 'utf8'));
    if (payload.date !== date) return { visits: [], observedAt: '' };
    return { visits: withAppointmentVisitConfirmations(Array.isArray(payload.visits) ? payload.visits : [], date), observedAt: String(payload.collection_timestamp || '') };
  } catch { return { visits: [], observedAt: '' }; }
}

export function scheduleVisitState(
  job: { appointmentId: string; truck: string; location?: Coordinates | null }, visits: AnyRecord[], observedAt: string,
  trucks: PresenceTruck[], now = Date.now(),
) {
  const fresh = (stamp: string | null) => { const age = now - Date.parse(stamp || ''); return age >= -60_000 && age <= LIVE_GPS_MAX_AGE_MS; };
  const confirmed = visits.filter(row => job.appointmentId && String(row.appointment_id || row.appt_id || '') === job.appointmentId
    && row.match_confidence === 'confirmed' && !row.pass_by_only
    && (Number(row.visit_count) > 0 || Number.isFinite(Date.parse(row.first_arrival || row.arrival_at || ''))));
  const activeVisit = fresh(observedAt) ? confirmed.find(row => {
    // GPS is the evidence of where a crew is working. JunkWare's assignment
    // can lag (or remain Unassigned), so do not hide a current, confirmed
    // visit merely because it does not yet agree with the schedule field.
    const visitTruck = truckLabel(String(row.truck_number || row.truck || ''));
    const truck = trucks.find(truck => visitTruck !== 'Unassigned' && truckLabel(truck.truck) === visitTruck);
    const position = truck && gpsPositionAtAppointment(job.location, truck, now);
    if (!position?.inside || !position.current) return false;
    const intervals = (Array.isArray(row.visit_intervals) ? row.visit_intervals : [])
      .filter((interval: AnyRecord) => Number.isFinite(Date.parse(interval.arrival || '')))
      .sort((a: AnyRecord, b: AnyRecord) => Date.parse(b.arrival) - Date.parse(a.arrival));
    const latest = intervals[0];
    const arrival = latest?.arrival || row.first_arrival || row.arrival_at;
    const departure = latest ? latest.departure : row.final_departure || row.departure_at;
    return Number.isFinite(Date.parse(arrival || '')) && Date.parse(arrival) <= now && position.stamp >= Date.parse(arrival) && !departure;
  }) : undefined;
  const openVisit = confirmed.find(row => {
    const latest = [...(Array.isArray(row.visit_intervals) ? row.visit_intervals : [])].sort((a,b)=>Date.parse(b.arrival)-Date.parse(a.arrival))[0];
    const visitTruck = truckLabel(String(row.truck_number || row.truck || ''));
    const truck = trucks.find(truck => visitTruck !== 'Unassigned' && truckLabel(truck.truck) === visitTruck);
    const position = truck && gpsPositionAtAppointment(job.location, truck, now);
    const lastInside = Math.max(...[...(row.source_timestamps || []), ...(latest?.source_timestamps || []), latest?.arrival || row.first_arrival || row.arrival_at]
      .map(stamp => Date.parse(stamp || '')).filter(stamp => Number.isFinite(stamp) && stamp <= now));
    // A newer position outside supersedes the open ledger, even if that GPS
    // report has since aged. Retain the visit and its recorded duration; do not
    // synthesize a departure or keep a misleading last-on-site badge.
    if (position && !position.inside && position.stamp > lastInside) return false;
    return Number.isFinite(Date.parse(latest?.arrival || row.first_arrival || '')) && !(latest ? latest.departure : row.final_departure || row.departure_at);
  });
  const lastSeenOnsiteTruck = !activeVisit && openVisit ? truckLabel(String(openVisit.truck_number || openVisit.truck || '')) : undefined;
  const lastSeenOnsiteAt = lastSeenOnsiteTruck ? [...(openVisit!.source_timestamps || []), ...(openVisit!.visit_intervals || []).flatMap((interval:AnyRecord)=>interval.source_timestamps || [interval.arrival])]
    .filter(stamp=>Number.isFinite(Date.parse(stamp)) && Date.parse(stamp)<=now).sort((a,b)=>Date.parse(b)-Date.parse(a))[0] || openVisit!.first_arrival : undefined;
  const onsiteTruck = activeVisit ? truckLabel(String(activeVisit.truck_number || activeVisit.truck || '')) : undefined;
  return { hasVisit: confirmed.length > 0, truckOnSite: Boolean(activeVisit), onsiteTruck, lastSeenOnsiteTruck, lastSeenOnsiteAt, onsiteTime: appointmentOnsiteTime(job, visits, now) };
}
