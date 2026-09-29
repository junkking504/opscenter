import type { DesktopAppointment } from './desktop-schedule';
import type { ScheduleReceipt } from './desktop-schedule-operations';
import { JUNKWARE_DISPATCH_TRUCKS, sameTruck } from './junkware-trucks';
import { readCrewDispatch, readCrewDispatchRequest, releaseCrewJob } from './crew-dispatch-store';
import type { CrewDispatchSources } from './crew-dispatch-service';
import { chicagoDateKey } from './chicago-date';

export type ScheduleCrewAssignment = {
  truck: string; expectedVersion: number;
  state: 'pending' | 'assigned' | 'queued' | 'attention'; message: string;
};

export function prepareScheduleCrewAssignment(job: Pick<DesktopAppointment,'status'|'appointmentId'>, truck: string): ScheduleCrewAssignment | undefined {
  if (!truck) return undefined;
  if (!JUNKWARE_DISPATCH_TRUCKS.includes(truck)) return undefined;
  if (!/^confirmed$/i.test(job.status)) return undefined;
  const state = readCrewDispatch(truck);
  return {truck,expectedVersion:state.version,state:'pending',message:'Waiting for the verified truck move before assigning Waypoint.'};
}

/** Resume only the Waypoint assignment recorded with this verified Schedule move. */
export async function applyScheduleCrewAssignment(receipt: ScheduleReceipt, sources: CrewDispatchSources): Promise<ScheduleCrewAssignment> {
  const intent = receipt.crewAssignment!;
  const appointmentId = receipt.recordId.split(':appointment:')[1];
  const result = (state: ScheduleCrewAssignment['state'], message:string) => ({...intent,state,message});
  try {
    const prior = readCrewDispatchRequest(intent.truck, receipt.requestId);
    if (prior) return result(prior.current?.appointmentId === appointmentId ? 'assigned' : 'queued', `${intent.truck} Waypoint assignment was saved.`);
    const source = await sources.assignment(appointmentId);
    if (source.appointmentId!==appointmentId || !sameTruck(source.truck,intent.truck) || source.date!==receipt.date || !/^confirmed$/i.test(source.status || '')) throw new Error('JunkWare no longer confirms this job on the selected truck.');
    if(receipt.date!==chicagoDateKey())return result('queued',`Assigned to ${intent.truck}'s Waypoint schedule for ${receipt.date}.`);
    const state = readCrewDispatch(intent.truck);
    if (state.current?.appointmentId===appointmentId && state.current.date===receipt.date) return result('assigned',`Assigned to ${intent.truck} in Waypoint.`);
    if (state.queued?.appointmentId===appointmentId && state.queued.date===receipt.date) return result('queued',`Queued for ${intent.truck} in Waypoint.`);
    if (state.current?.date===receipt.date && state.queued) return result('queued',`Assigned to ${intent.truck}'s daily Waypoint schedule. Closeout follows the current job.`);
    const saved = releaseCrewJob({truck:intent.truck,requestId:receipt.requestId,expectedVersion:state.version,appointmentId,date:receipt.date},receipt.actor);
    return saved.current?.appointmentId===appointmentId
      ? result('assigned',`Assigned to ${intent.truck} in Waypoint.`)
      : result('queued',`Queued for ${intent.truck} in Waypoint.`);
  } catch(error) {
    return result('attention',`The truck assignment is saved, but Waypoint needs attention. ${error instanceof Error ? error.message : 'Waypoint could not be verified.'} Open Crew Dispatch; do not repeat the Schedule move.`);
  }
}
