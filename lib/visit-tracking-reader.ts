import fs from 'node:fs';
import path from 'node:path';
import {buildFleetMapPayload} from './fleet-map';
import {readJobRows} from './desktop-schedule-source';
import {planningLocation} from './planning-geocodes';
import {reconcileAppointmentPositions} from './appointment-position-tracking';
import {readGeofenceEntries} from './linxup-geofence-alerts';
import {readScheduleVisits} from './desktop-schedule-visits';
import {trackAppointmentVisits, VISIT_TRACKING_AGENT} from './visit-tracking-agent';

/** One local source reader for background runs and on-demand projections. */
export function readVisitTrackingAgent(date: string) {
  const geofences = readGeofenceEntries(date);
  const appointments = readScheduleVisits(date);
  const fleet = buildFleetMapPayload(date);
  const root=process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data');
  let pins: Record<string,Record<string,unknown>> = {};
  try { pins=JSON.parse(fs.readFileSync(path.join(root,'cache','appointment_geocodes.json'),'utf8')).addresses || {}; } catch { /* Unverified coordinates cannot establish departure. */ }
  const locations = readJobRows(date).map(job=>({appointmentId:job.appointmentId,jkNumber:job.jkNumber,location:planningLocation(job.address,pins)}));
  const appointmentVisits = reconcileAppointmentPositions(trackAppointmentVisits(date,appointments.visits),locations,fleet?.trucks || []);
  return {agentId:VISIT_TRACKING_AGENT,date,
    visits:[...geofences.trackedVisits,...appointmentVisits],
    sourceHealth:{...geofences.sourceHealth,appointmentsObservedAt:appointments.observedAt},
    complete:geofences.complete && !!appointments.observedAt};
}
