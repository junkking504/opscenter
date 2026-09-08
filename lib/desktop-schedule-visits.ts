import { appointmentOnsiteTime } from './appointment-onsite-time';
import fs from 'node:fs';
import path from 'node:path';
import { withAppointmentVisitConfirmations } from '@/lib/appointment-visit-confirmations';
import { truckLabel, type ScheduleTruck } from '../desktop-ui/lib/schedule-contract';
import type { AnyRecord } from '@/lib/opsData';

// Keep the server-side Schedule status in step with the Dispatch map. A
// five-minute reporting gap is still recent, continuous LinxUp evidence;
// older positions must not be shown as current on-site work.
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
  job: { appointmentId: string; truck: string }, visits: AnyRecord[], observedAt: string,
  trucks: Pick<ScheduleTruck, 'truck' | 'lastGpsUpdate'>[], now = Date.now(),
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
    const truckFresh = visitTruck !== 'Unassigned' && trucks.some(truck => truckLabel(truck.truck) === visitTruck && fresh(truck.lastGpsUpdate));
    if (!truckFresh) return false;
    const intervals = (Array.isArray(row.visit_intervals) ? row.visit_intervals : [])
      .filter((interval: AnyRecord) => Number.isFinite(Date.parse(interval.arrival || '')))
      .sort((a: AnyRecord, b: AnyRecord) => Date.parse(b.arrival) - Date.parse(a.arrival));
    const latest = intervals[0];
    const arrival = latest?.arrival || row.first_arrival || row.arrival_at;
    const departure = latest ? latest.departure : row.final_departure || row.departure_at;
    return Number.isFinite(Date.parse(arrival || '')) && Date.parse(arrival) <= now && !departure;
  }) : undefined;
  const onsiteTruck = activeVisit ? truckLabel(String(activeVisit.truck_number || activeVisit.truck || '')) : undefined;
  return { hasVisit: confirmed.length > 0, truckOnSite: Boolean(activeVisit), onsiteTruck, onsiteTime: appointmentOnsiteTime(job, visits, now) };
}
