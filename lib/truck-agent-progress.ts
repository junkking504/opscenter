import { agentTruckNumber, type TruckAgentProgress } from '../desktop-ui/lib/truck-agent-contract';
import type { AgentJob, AgentGps, TruckAgentInputs } from './truck-agent-rules';
import { gpsDistanceMeters, validGpsCoordinates, GPS_SITE_RADIUS_METERS, GPS_PRESENCE_MAX_AGE_MS, GPS_MAX_POINT_GAP_MS, GPS_MINIMUM_DWELL_MS } from './gps-presence-policy';
import { parkedTruckObservation, PARKED_GPS_MAX_AGE_MS } from './truck-gps-status';
import { currentGpsPresence } from './schedule-gps-presence';

// Advisory search distance only. This never changes the shared arrival geofence.
export const AGENT_NEARBY_RADIUS_METERS = 300;

function stoppedSince(gps: AgentGps) {
  if (gps.speed !== 0 || !gps.at || !validGpsCoordinates(gps)) return null;
  const stamp = Date.parse(gps.at);
  const points = [...(gps.points || [])].filter(p => Date.parse(p.timestamp) < stamp)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  let earliest = stamp;
  for (const point of points) {
    const time = Date.parse(point.timestamp);
    if (!Number.isFinite(time) || earliest - time > GPS_MAX_POINT_GAP_MS
      || point.speed !== 0 || gpsDistanceMeters(gps, point) > 30) break;
    earliest = time;
  }
  // A stationary engine shutdown is also explicit stop evidence, using the
  // same ON -> OFF signal as Schedule. A lone zero-speed fix is insufficient.
  const previous = points[0];
  const shutdown = gps.ignition === 'OFF' && previous?.ignition === 'ON'
    && previous.speed === 0 && earliest < stamp;
  return stamp - earliest >= GPS_MINIMUM_DWELL_MS || shutdown ? new Date(earliest).toISOString() : null;
}

/** Describe source-supported progress without publishing an arrival or changing a job. */
export function truckAgentProgress(n: number, jobs: AgentJob[], gps: AgentGps, visits: TruckAgentInputs['visits'], now: number): TruckAgentProgress | null {
  const stamp = Date.parse(gps.at || '');
  const current = now - stamp <= GPS_PRESENCE_MAX_AGE_MS;
  if (!Number.isFinite(stamp) || stamp > now || !validGpsCoordinates(gps)
    || (!current && (!parkedTruckObservation(gps) || now - stamp > PARKED_GPS_MAX_AGE_MS))) return null;
  const open = jobs.filter(j => !/cancel|no.?show|complet|closed/i.test(j.status));
  const own = open.filter(j => agentTruckNumber(j.truck) === n);
  const position = { ...gps, lastGpsUpdate: gps.at, routePoints: gps.points };
  const presenceJobs = open.map(j => ({ ...j, appointmentId: j.id, appointmentStartMinutes: j.start, appointmentEndMinutes: j.end,
    onsiteTime: { departure: visits.available ? visits.data.filter(v => v.appointmentId === j.id && agentTruckNumber(v.truck) === n && v.departed)
      .map(v => v.departed!).sort().at(-1) : null } }));
  for (const job of current ? own : []) {
    const presence = currentGpsPresence(presenceJobs.find(j => j.id === job.id)!, [position], presenceJobs, now);
    if (presence?.current) return { kind: 'on_site', label: `On site: ${job.number}`, jobIds: [job.id], jobNumbers: [job.number],
      observedAt: gps.at!, stoppedSince: presence.arrival, distanceMeters: Math.round(gpsDistanceMeters(gps, job.location!)),
      detail: 'Current GPS meets the shared Schedule presence rules. The source appointment remains open.' };
  }
  const since = stoppedSince(gps);
  if (since) {
    const nearby = open.filter(j => j.location && gpsDistanceMeters(gps, j.location) <= AGENT_NEARBY_RADIUS_METERS);
    const assigned = nearby.filter(j => agentTruckNumber(j.truck) === n);
    if (assigned.length) {
      const ambiguous = nearby.length > 1;
      const distanceMeters = Math.round(Math.min(...assigned.map(j => gpsDistanceMeters(gps, j.location!))));
      const outside = assigned.every(j => gpsDistanceMeters(gps, j.location!) > GPS_SITE_RADIUS_METERS);
      return { kind: 'nearby', label: current ? 'Stopped nearby — arrival unconfirmed' : 'Last report: stopped nearby — arrival unconfirmed', jobIds: nearby.map(j => j.id), jobNumbers: nearby.map(j => j.number), observedAt: gps.at!, stoppedSince: since, distanceMeters,
        detail: (!current ? 'The last engine-off report showed this stop; current position is unconfirmed. ' : '') + (ambiguous ? 'Multiple open appointments are nearby; GPS does not identify which appointment this stop serves.'
          : outside ? `Outside the ${GPS_SITE_RADIUS_METERS}-metre arrival boundary. Review parking or loading access and the verified address pin.`
            : 'Inside the arrival boundary, but the shared Schedule presence rules have not established this arrival.') };
    }
  }
  // Consume the shared tracker rather than inventing departure times. A newer
  // position away from the pin must corroborate a recorded completed visit.
  const departed = visits.available ? visits.data.filter(v => own.some(j => j.id === v.appointmentId)
    && agentTruckNumber(v.truck) === n && v.departed && !v.conflict && !v.superseded
    && Date.parse(v.departed) >= Date.parse(v.entered) && Date.parse(v.departed) <= stamp)
    .sort((a, b) => b.departed!.localeCompare(a.departed!)).find(v => {
      const job = own.find(j => j.id === v.appointmentId)!;
      return job.location && gpsDistanceMeters(gps, job.location) > GPS_SITE_RADIUS_METERS;
    }) : undefined;
  if (departed) {
    const job = own.find(j => j.id === departed.appointmentId)!;
    return { kind: 'visited', label: `Visit recorded: ${job.number}`, jobIds: [job.id], jobNumbers: [job.number], observedAt: departed.departed!, stoppedSince: null, distanceMeters: null,
      detail: 'The shared visit tracker records a visit and departure. The source appointment remains open; check progress or closeout.' };
  }
  return null;
}
