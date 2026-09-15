import {readGeofenceEntries} from './linxup-geofence-alerts';
import {readScheduleVisits} from './desktop-schedule-visits';
import {trackAppointmentVisits, VISIT_TRACKING_AGENT} from './visit-tracking-agent';

/** One local source reader for background runs and on-demand projections. */
export function readVisitTrackingAgent(date: string) {
  const geofences = readGeofenceEntries(date);
  const appointments = readScheduleVisits(date);
  return {agentId:VISIT_TRACKING_AGENT,date,
    visits:[...geofences.trackedVisits,...trackAppointmentVisits(date,appointments.visits)],
    sourceHealth:{...geofences.sourceHealth,appointmentsObservedAt:appointments.observedAt},
    complete:geofences.complete && !!appointments.observedAt};
}
