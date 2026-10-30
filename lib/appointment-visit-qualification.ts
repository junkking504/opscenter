/** Appointment GPS proximity is retained in the source ledger. Only a supported
 * five-minute episode qualifies as a visit; disjoint passes never add together. */
export const APPOINTMENT_LOITER_MS = 5 * 60_000;
type Gap = {start?: string; end?: string};
export type AppointmentObservation = {
  first_arrival?: string; arrival_at?: string; final_departure?: string; departure_at?: string;
  gps_coverage_gaps?: Gap[]; source_timestamps?: string[]; operational_confirmation?: boolean; visit_count?: number;
  visit_intervals?: AppointmentObservationInterval[];
};
export type AppointmentObservationInterval = {
  arrival?: string; departure?: string | null; departure_confirmed?: boolean;
  source_timestamps?: string[]; coverage_gaps?: Gap[];
};
export function appointmentIntervalQualifies(interval: AppointmentObservationInterval, now = Date.now(), fallbackTimes: string[] = []) {
  const start = Date.parse(interval.arrival || ''), end = Date.parse(interval.departure || '');
  if (!Number.isFinite(start) || start > now) return false;
  const closed = interval.departure_confirmed !== false && Number.isFinite(end) && end >= start && end <= now;
  const source = interval.source_timestamps?.length ? interval.source_timestamps : fallbackTimes;
  // Legacy confirmed closed intervals without individual fixes retain their
  // source timing only when no coverage gap contradicts it. Open wall-clock age
  // never establishes dwell.
  if (!source.length) return closed && end-start >= APPOINTMENT_LOITER_MS && !interval.coverage_gaps?.length;
  const times = [...new Set([start,...source.map(Date.parse)].filter(t=>Number.isFinite(t) && t>=start && t<=now && (!closed || t<=end)))].sort((a,b)=>a-b);
  let anchor = times[0];
  for (let i=1;i<times.length;i++) {
    const previous=times[i-1], current=times[i];
    const gap=interval.coverage_gaps?.some(g=>Date.parse(g.start || '')<current && Date.parse(g.end || '')>previous);
    if (current-previous>APPOINTMENT_LOITER_MS || gap) anchor=current;
    if (current-anchor>=APPOINTMENT_LOITER_MS) return true;
  }
  return false;
}
/** Source completion is independent evidence. It preserves recorded actual
 * timing for completed jobs, but does not promote proximity into an alert. */
export function qualifiedAppointmentVisits<T extends AppointmentObservation>(rows:T[], status = '', now = Date.now()): T[] {
  if (/cancel/i.test(status)) return [];
  if (/complete|closed/i.test(status)) return rows;
  return rows.flatMap(row=>{
    if (row.operational_confirmation) return [row];
    if (!row.visit_intervals?.length && (row.visit_count || 0)>1) return [];
    const source=row.visit_intervals?.length ? row.visit_intervals : [{arrival:row.first_arrival || row.arrival_at,departure:row.final_departure || row.departure_at}];
    const intervals=source.map(interval=>({
      ...interval,
      coverage_gaps:[...(interval.coverage_gaps || []),...(row.gps_coverage_gaps || []).filter(gap=>
        Date.parse(gap.end || '')>Date.parse(interval.arrival || '') &&
        Date.parse(gap.start || '')<Date.parse(interval.departure || new Date(now).toISOString()))],
      source_timestamps:[...(interval.source_timestamps || []),...(source.length===1 ? row.source_timestamps || [] : [])],
    })).filter(interval=>appointmentIntervalQualifies(interval,now));
    if (!intervals.length) return [];
    const ordered=[...intervals].sort((a,b)=>Date.parse(a.arrival!)-Date.parse(b.arrival!));
    return [{...row,visit_intervals:ordered,visit_count:ordered.length,
      first_arrival:ordered[0].arrival,arrival_at:ordered[0].arrival,
      final_departure:ordered.at(-1)!.departure,departure_at:ordered.at(-1)!.departure,
      source_timestamps:ordered.flatMap(i=>i.source_timestamps || [])}];
  });
}
