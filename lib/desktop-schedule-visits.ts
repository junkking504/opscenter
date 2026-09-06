import { appointmentOnsiteTime } from './appointment-onsite-time';
import fs from 'node:fs';
import path from 'node:path';
import { withAppointmentVisitConfirmations } from '@/lib/appointment-visit-confirmations';
import { truckLabel, type ScheduleTruck } from '../desktop-ui/lib/schedule-contract';
import type { AnyRecord } from '@/lib/opsData';

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
  const fresh = (stamp: string | null) => { const age = now - Date.parse(stamp || ''); return age >= -60_000 && age <= 180_000; };
  const confirmed = visits.filter(row => job.appointmentId && String(row.appointment_id || row.appt_id || '') === job.appointmentId
    && row.match_confidence === 'confirmed' && !row.pass_by_only
    && (Number(row.visit_count) > 0 || Number.isFinite(Date.parse(row.first_arrival || row.arrival_at || ''))));
  const truck = truckLabel(job.truck);
  const truckFresh = truck !== 'Unassigned' && trucks.some(row => truckLabel(row.truck) === truck && fresh(row.lastGpsUpdate));
  const truckOnSite = fresh(observedAt) && truckFresh && confirmed.some(row => {
    if (truckLabel(String(row.truck_number || '')) !== truck) return false;
    const intervals = (Array.isArray(row.visit_intervals) ? row.visit_intervals : [])
      .filter((interval: AnyRecord) => Number.isFinite(Date.parse(interval.arrival || '')))
      .sort((a: AnyRecord, b: AnyRecord) => Date.parse(b.arrival) - Date.parse(a.arrival));
    const latest = intervals[0];
    const arrival = latest?.arrival || row.first_arrival || row.arrival_at;
    const departure = latest ? latest.departure : row.final_departure || row.departure_at;
    return Number.isFinite(Date.parse(arrival || '')) && Date.parse(arrival) <= now && !departure;
  });
  return { hasVisit: confirmed.length > 0, truckOnSite, onsiteTime: appointmentOnsiteTime(job, visits, now) };
}
