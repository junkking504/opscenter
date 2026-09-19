import type { DesktopAppointment } from './desktop-schedule';
import type { ScheduleReceipt } from './desktop-schedule-operations';
import { CrewPhoneError } from './crew-phone';
import { JUNKWARE_DISPATCH_TRUCKS } from './junkware-trucks';
import { readCrewDispatch, readCrewDispatchRequest, releaseCrewJob } from './crew-dispatch-store';
import { crewScheduleFresh, type CrewDispatchSources } from './crew-dispatch-service';

export type ScheduleCrewAssignment = {
  truck: string; expectedVersion: number;
  state: 'pending' | 'assigned' | 'queued' | 'attention'; message: string;
};
export function prepareScheduleCrewAssignment(job: Pick<DesktopAppointment,'status'|'appointmentId'>, truck: string): ScheduleCrewAssignment {
  if (!/^confirmed$/i.test(job.status) || !JUNKWARE_DISPATCH_TRUCKS.includes(truck)) throw new CrewPhoneError('Choose a confirmed appointment and a truck for crew assignment.',409);
  const state = readCrewDispatch(truck);
  const already = state.current?.appointmentId === job.appointmentId || state.queued?.appointmentId === job.appointmentId;
  if (state.queued && !already) throw new CrewPhoneError(`${truck} already has a current and queued job. Remove its queued assignment in Crew Dispatch before moving another job.`,409);
  return {truck,expectedVersion:state.version,state:'pending',message:'Waiting for the verified truck move before assigning the phone.'};
}
export async function applyScheduleCrewAssignment(receipt: ScheduleReceipt, sources: CrewDispatchSources): Promise<ScheduleCrewAssignment> {
  const intent = receipt.crewAssignment!;
  const appointmentId = receipt.recordId.split(':appointment:')[1];
  const result = (state: ScheduleCrewAssignment['state'], message:string) => ({...intent,state,message});
  try {
    // A crash after the durable release cannot disclose the same job again, even
    // if a later manager action or closeout has already changed the queue.
    const prior = readCrewDispatchRequest(intent.truck,receipt.requestId);
    if (prior) return result(prior.current?.appointmentId===appointmentId?'assigned':'queued',`${intent.truck} phone assignment was saved.`);
    const source = await sources.assignment(appointmentId);
    if (source.appointmentId!==appointmentId || source.truck!==intent.truck || source.date!==receipt.date || !/^confirmed$/i.test(source.status || '')) throw new Error('JunkWare no longer confirms this job on the selected truck.');
    const snapshot = sources.schedule(receipt.date);
    const matches = snapshot.appointments.filter(job=>job.appointmentId===appointmentId);
    const job = matches.length===1 ? matches[0] : null;
    if (!crewScheduleFresh(snapshot.observedAt) || !job || job.truck!==intent.truck || !/^confirmed$/i.test(job.status) || (job.junkwareSyncStatus && job.junkwareSyncStatus!=='verified')) throw new Error('Refresh the schedule before assigning the phone.');
    const state = readCrewDispatch(intent.truck);
    if (state.current?.appointmentId===appointmentId && state.current.date===receipt.date) return result('assigned',`Assigned to ${intent.truck}’s phone. Refresh assignment on the phone.`);
    if (state.queued?.appointmentId===appointmentId && state.queued.date===receipt.date) return result('queued',`Queued for ${intent.truck}. It stays hidden until the current job closes with photos.`);
    const saved = releaseCrewJob({truck:intent.truck,requestId:receipt.requestId,expectedVersion:intent.expectedVersion,appointmentId,date:receipt.date},receipt.actor);
    return saved.current?.appointmentId===appointmentId
      ? result('assigned',`Assigned to ${intent.truck}’s phone. Refresh assignment on the phone.`)
      : result('queued',`Queued for ${intent.truck}. It stays hidden until the current job closes with photos.`);
  } catch(error) {
    return result('attention',`The schedule move is saved, but the phone assignment needs attention. ${error instanceof Error ? error.message : 'Dispatch could not be verified.'} Open Crew Dispatch; do not repeat the move.`);
  }
}
