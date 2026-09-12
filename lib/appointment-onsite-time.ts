type VisitRecord = { onsite_minutes?: number; appointment_id?: string; appt_id?: string; jk_number?: string; job_id?: string; truck_number?: string | number; truck?: string; match_confidence?: string; pass_by_only?: boolean; first_arrival?: string; arrival_at?: string; final_departure?: string; departure_at?: string; visit_intervals?: Array<{arrival?: string; departure?: string | null; departure_confirmed?: boolean}> };

export type AppointmentOnsiteTime = { minutes: number | null; arrival: string | null; departure: string | null; label: string };
const truckKey = (value: unknown) => String(value || '').match(/\d+/)?.[0]?.replace(/^0+/, '') || '';
export function appointmentOnsiteTime(job: { appointmentId?: string; jkNumber?: string; truck?: string }, visits: VisitRecord[], now = Date.now()): AppointmentOnsiteTime {
  const unavailable = { minutes: null, arrival: null, departure: null, label: 'Unavailable · no confirmed visit' };
  const byReference = visits.filter(row => job.appointmentId
    ? String(row.appointment_id || row.appt_id || '') === job.appointmentId
    : job.jkNumber && String(row.jk_number || row.job_id || '').toUpperCase() === job.jkNumber.toUpperCase());
  if (!job.appointmentId && new Set(byReference.map(row=>String(row.appointment_id || row.appt_id || ''))).size !== 1) return unavailable;
  const matched = byReference.filter(row => row.match_confidence === 'confirmed' && !row.pass_by_only
    && (!truckKey(job.truck) || truckKey(row.truck_number || row.truck) === truckKey(job.truck)));
  if (!matched.length || new Set(matched.map(row=>truckKey(row.truck_number || row.truck))).size > 1) return unavailable;
  const intervals: Array<[number, number]> = [];
  const arrivals: number[] = [];
  let pending = false;
  let invalid = false;
  for (const row of matched) {
    const source = Array.isArray(row.visit_intervals) && row.visit_intervals.length ? row.visit_intervals : [{ arrival: row.first_arrival || row.arrival_at, departure: row.final_departure || row.departure_at }];
    for (const interval of source) {
      const start = Date.parse(interval.arrival || '');
      if (!Number.isFinite(start) || start > now) { invalid = true; continue; }
      arrivals.push(start);
      if (!interval.departure || interval.departure_confirmed === false) { pending = true; continue; }
      const end = Date.parse(interval.departure);
      if (!Number.isFinite(end) || end <= start || end > now) { invalid = true; continue; }
      intervals.push([start, end]);
    }
  }
  if (pending) return { ...unavailable, arrival: !invalid && arrivals.length ? new Date(Math.min(...arrivals)).toISOString() : null, label: 'Awaiting recorded departure' };
  if (invalid || !intervals.length) return { ...unavailable, label: 'Unavailable · incomplete visit timestamps' };
  // Merge overlapping or duplicated observations; exclude time away between visits.
  const merged: Array<[number, number]> = [];
  for (const interval of intervals.sort((a,b)=>a[0]-b[0])) {
    const last = merged.at(-1);
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  const minutes = Math.round(merged.reduce((sum,[start,end])=>sum+end-start,0) / 6000) / 10;
  return { minutes, arrival: new Date(merged[0][0]).toISOString(), departure: new Date(merged.at(-1)![1]).toISOString(), label: `${minutes} min${merged.length > 1 ? ` · ${merged.length} visits` : ''}` };
}

export function onsiteTimeFacts(time: AppointmentOnsiteTime) {
  const clock = (value: string) => new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(value));
  return [{label:'On-site time',value:time.label},
    ...(time.arrival ? [{label:'Arrival',value:clock(time.arrival)}] : []),
    ...(time.departure ? [{label:'Departure',value:clock(time.departure)}] : [])];
}
