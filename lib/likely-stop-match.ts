import type {GpsTrip} from '../desktop-ui/lib/gps-route-contract';
import {gpsDistanceMeters, validGpsCoordinates} from './gps-presence-policy';
import {normalizeServiceAddress} from './service-address-format';

export type LikelyStop = {
  truck: string; arrival: string; departure: string | null; stopAddress: string;
  /** Why this stop was suggested; the match is never treated as confirmed. */
  reason: string;
  /** Dwelled long enough and departed (or the job was closed out): safe to treat as the visit. */
  confident: boolean;
};
type Point = {latitude: number; longitude: number};
type LikelyJob = {status?: string; address?: string; truck: string; location?: Point | null; mapFallback?: {location?: Point} | null;
  appointmentStartMinutes?: number | null; appointmentEndMinutes?: number | null; hasScheduledTime?: boolean};

const NEAR_METERS = 400, FAR_METERS = 1500, EARLY_MS = 2 * 3600_000, LATE_MS = 3 * 3600_000;

function parts(address: string) {
  const [street = '', city = '', ...rest] = address.split(',').map(part => part.trim());
  const match = street.match(/^(\d+[A-Z]?)\s+(.+)$/i);
  if (!match) return null;
  return {house: match[1].toUpperCase(), street: normalizeServiceAddress(match[2]), city: normalizeServiceAddress(city), zip: rest.join(' ').match(/\b\d{5}\b/)?.[0] || ''};
}
/** One substituted or transposed digit (8330 vs 8830, 8303 vs 8330). */
function nearHouse(a: string, b: string) {
  if (a === b) return true;
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b) || a.length !== b.length || a.length < 3) return false;
  const diff = [...a].flatMap((ch, i) => ch === b[i] ? [] : [i]);
  return diff.length === 1 || diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}
const chicagoMinutes = (stamp: number, day: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(stamp).map(x => [x.type, x.value]));
  return (Date.parse(`${p.year}-${p.month}-${p.day}`) - Date.parse(day)) / 60_000 + +p.hour * 60 + +p.minute;
};

/** Suggests the assigned truck's recorded GPS stop for an appointment whose
 * address could not be matched exactly (typo, unresolved geocode). Requires the
 * same street and locality, an exact or one-digit-off house number, and a stop
 * that begins near the booked window. `confident` stops (dwell then departure, or
 * closed out) are treated as the visit by the caller; others stay suggestions. */
export function likelyGpsStop(job: LikelyJob, trips: GpsTrip[] | undefined, day: string): LikelyStop | null {
  if (!job.address || /cancel/i.test(job.status || '') || !/^Truck [1-9]\d*$/.test(job.truck) || !trips?.length) return null;
  const want = parts(job.address);
  if (!want || job.appointmentStartMinutes == null || job.appointmentEndMinutes == null) return null;
  const pin = [job.location, job.mapFallback?.location].find((p): p is Point => !!p && validGpsCoordinates(p));
  const ordered = [...trips].sort((a, b) => a.arrival.localeCompare(b.arrival));
  const found = ordered.flatMap((trip, index) => {
    const got = parts(trip.to.address);
    if (!got || got.street !== want.street || !nearHouse(want.house, got.house)) return [];
    if (want.city && got.city && want.city !== got.city || want.zip && got.zip && want.zip !== got.zip) return [];
    const meters = pin && validGpsCoordinates(trip.to) ? gpsDistanceMeters(pin, trip.to) : null;
    if (meters !== null && meters > FAR_METERS) return [];
    const arrival = Date.parse(trip.arrival), start = chicagoMinutes(arrival, day);
    if (!Number.isFinite(arrival) || start < job.appointmentStartMinutes! - EARLY_MS / 60_000 || start > job.appointmentEndMinutes! + LATE_MS / 60_000) return [];
    const next = ordered[index + 1];
    const departure = next && Date.parse(next.departure) >= arrival ? next.departure : null;
    const exact = want.house === got.house;
    const closed = /complete|closed|paid/i.test(job.status || '');
    const dwellMinutes = departure ? (Date.parse(departure) - arrival) / 60_000 : 0;
    // Present for a while and left, or left after the job was closed out.
    const confident = !!departure && (dwellMinutes >= 10 || closed && dwellMinutes >= 5);
    return [{distance: Math.abs(start - job.appointmentStartMinutes!), stop: {confident, truck: job.truck, arrival: trip.arrival, departure, stopAddress: trip.to.address,
      reason: `${exact ? 'Same address' : `GPS stop at ${got.house} ${got.street.toLowerCase()} (booked ${want.house})`} · ${job.truck} · ${confident ? 'matched by GPS dwell' : 'unconfirmed'}${meters !== null && meters <= NEAR_METERS ? ' · within 400 m of the map pin' : ''}`}}];
  });
  // Several different stops at this address cannot be told apart reliably.
  if (found.length > 1 && new Set(found.map(row => row.stop.stopAddress)).size > 1) return null;
  return found.sort((a, b) => a.distance - b.distance)[0]?.stop || null;
}
