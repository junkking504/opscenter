/** A zero-length closed observation needs explicit source departure confirmation.
 * Open observations remain eligible for separate live GPS presence checks. */
export function hasVisitIntervalEvidence(row: {visit_pin?:{approximate?:boolean}; visit_intervals?: Array<{arrival?: string; departure?: string | null; departure_confirmed?:boolean}>; first_arrival?: string; arrival_at?: string; final_departure?: string; departure_at?: string}) {
  const intervals = row.visit_intervals?.length ? row.visit_intervals : [{arrival:row.first_arrival || row.arrival_at,departure:row.final_departure || row.departure_at}];
  return intervals.some(interval => Number.isFinite(Date.parse(interval.arrival || '')) && (!interval.departure || (Date.parse(interval.departure) > Date.parse(interval.arrival || '') || 'departure_confirmed' in interval && interval.departure_confirmed === true && Date.parse(interval.departure) === Date.parse(interval.arrival || ''))));
}
