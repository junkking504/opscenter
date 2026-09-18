import type { CrewPhone } from './crew-phone';
import { CrewPhoneError } from './crew-phone';
import type { CrewAssignment, CrewCurrent, CrewCurrentJob } from './crew-dispatch';
import type { CrewCompletionReceipt } from './crew-job-release';
import { advanceCrewDispatch, matchingCrewCompletion, readCrewDispatch, releaseCrewJob } from './crew-dispatch-store';

type Job = Omit<CrewCurrentJob, 'assignmentId' | 'date'> & { truck: string; version: string; status: string; junkwareSyncStatus?: string };
export type DispatchReceipt = CrewCompletionReceipt & { requestId:string;recordId:string;date:string;createdAt?:string;updatedAt:string };
export type CrewDispatchSources = {
  schedule(date:string): {observedAt:string|null;appointments:Job[]};
  receipts(current:CrewAssignment): Promise<DispatchReceipt[]>;
  assignment(id:string): Promise<{appointmentId:string;truck:string;date:string;status?:string}>;
  closeout(id:string): Promise<CrewCompletionReceipt['sourceResult']>;
};
export function crewScheduleFresh(observedAt: string | null, now = new Date()) {
  const at = Date.parse(observedAt || '');
  return Number.isFinite(at) && at<=now.getTime() && now.getTime()-at<=10*60_000;
}
/** Fresh source checks happen before release; no source appointment is changed. */
export async function dispatchCrewJob(input:{truck:string;requestId:string;expectedVersion:number;appointmentId:string;date:string;expectedJobVersion:string}, actor:string, sources:CrewDispatchSources) {
  const snapshot = sources.schedule(input.date);
  const matches = snapshot.appointments.filter(job=>job.appointmentId===input.appointmentId);
  const job = matches.length===1 ? matches[0] : null;
  if (!crewScheduleFresh(snapshot.observedAt) || !job || job.version!==input.expectedJobVersion || job.truck!==input.truck
    || !/^confirmed$/i.test(job.status) || (job.junkwareSyncStatus && job.junkwareSyncStatus!=='verified')) throw new CrewPhoneError('Refresh the schedule and choose a confirmed job assigned to this truck.',409);
  const source = await sources.assignment(job.appointmentId);
  if (source.appointmentId!==job.appointmentId || source.truck!==input.truck || source.date!==input.date || !/^confirmed$/i.test(source.status || '')) throw new CrewPhoneError('JunkWare no longer confirms this appointment for the selected truck and date.',409);
  // Re-read the local version after source verification; a concurrent office edit
  // cannot be accepted from the stale menu the manager started with.
  const latest = sources.schedule(input.date);
  const same = latest.appointments.filter(row=>row.appointmentId===job.appointmentId);
  if (!crewScheduleFresh(latest.observedAt) || same.length!==1 || same[0].version!==input.expectedJobVersion) throw new CrewPhoneError('The appointment changed. Refresh before assigning it.',409);
  return releaseCrewJob(input,actor);
}
export async function crewCurrentPayload(phone: CrewPhone, sources:CrewDispatchSources): Promise<CrewCurrent> {
  const unavailable = (message = 'The current assignment could not be verified. Contact dispatch.'): CrewCurrent => ({state:'unavailable',truck:phone.truck,job:null,observedAt:null,message});
  let state = readCrewDispatch(phone.truck);
  if (state.current) {
    const candidates = (await sources.receipts(state.current)).filter(receipt=>matchingCrewCompletion(state,receipt)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    if (candidates.length) {
      // An old receipt alone is never permission to disclose another customer.
      const source = await sources.closeout(state.current.appointmentId);
      try { state = advanceCrewDispatch(state,candidates[0],source); }
      catch (error) { if (!(error instanceof CrewPhoneError)) throw error; return unavailable('Completion is not yet verified. Contact dispatch.'); }
    }
  }
  if (!state.current) return {state:'waiting',truck:phone.truck,job:null,observedAt:null};
  const current = state.current;
  const source = await sources.assignment(current.appointmentId);
  if (source.appointmentId!==current.appointmentId || source.truck!==phone.truck || source.date!==current.date
    || !/^(confirmed|completed)$/i.test(source.status || '')) return unavailable();
  // A server-side whitelist, not a serialized schedule with hidden rows.
  const snapshot = sources.schedule(current.date);
  const matches = snapshot.appointments.filter(job=>job.appointmentId===current.appointmentId && job.truck===phone.truck);
  const job = matches.length===1 ? matches[0] : null;
  if (!crewScheduleFresh(snapshot.observedAt) || !job || (job.junkwareSyncStatus && job.junkwareSyncStatus!=='verified')) return unavailable();
  const finalState = readCrewDispatch(phone.truck);
  if (finalState.current?.assignmentId!==current.assignmentId) return unavailable('Dispatch changed. Refresh your assignment.');
  return {state:'assigned',truck:phone.truck,observedAt:snapshot.observedAt,job:{
    assignmentId:current.assignmentId,appointmentId:current.appointmentId,date:current.date,jkNumber:job.jkNumber,
    customerName:job.customerName,address:job.address,appointmentTime:job.appointmentTime,
    junkItems:job.junkItems,appointmentNotes:job.appointmentNotes,driver:job.driver,navigator:job.navigator,
  }};
}
