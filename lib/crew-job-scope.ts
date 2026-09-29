import { sameTruck } from './junkware-trucks';
import { requireCrewReady } from './crew-phone-http';
import { requireCrewDay } from './crew-phone-day';
import { CrewPhoneError } from './crew-phone';
import { readCrewDispatch } from './crew-dispatch-store';
import { readDesktopSchedule } from './desktop-schedule';
import { crewScheduleFresh } from './crew-dispatch-service';
import { readJunkwareTruckAssignment } from './junkware-truck-assignment';
import { withJunkwareAppointmentSyncLock } from './job-route-assignments';
import {crewAssignedDay} from './crew-assigned-day';

function scheduledAssignment(phone:ReturnType<typeof requireCrewReady>,date:string,assignmentId:string,
  assignedDay:typeof crewAssignedDay=crewAssignedDay) {
  const dispatch=readCrewDispatch(phone.truck).current;
  const payload=assignedDay(phone,date);
  const job=payload.jobs?.find(row=>row.assignmentId===assignmentId);
  if(!job)return null;
  if(dispatch?.assignmentId===assignmentId && dispatch.date===date && dispatch.appointmentId===job.appointmentId)return {current:dispatch,job};
  return {current:{assignmentId,appointmentId:job.appointmentId,date,releasedAt:payload.observedAt || new Date().toISOString()},job};
}

/** Local read/staging gate only. JunkWare writes still use withCrewJob below. */
export function readCrewJobScope(request:Request,assignmentId:string) {
  const phone=requireCrewReady(request),day=requireCrewDay(phone),scope=scheduledAssignment(phone,day.date,assignmentId);
  if(!scope)throw new CrewPhoneError('This truck assignment changed or is updating. Refresh assignments.',409);
  return {phone,day,...scope};
}

const sources = { schedule: readDesktopSchedule, assignment: readJunkwareTruckAssignment, assignedDay:crewAssignedDay };
/** Resolve authority from the cookie and fresh server-owned truck day, never a
 * phone-supplied appointment. Durable current-dispatch IDs remain accepted. */
export async function withCrewJob<T>(request: Request, assignmentId: string,
  run: (scope: { phone: ReturnType<typeof requireCrewReady>; current: NonNullable<ReturnType<typeof readCrewDispatch>['current']>; job: ReturnType<typeof readDesktopSchedule>['appointments'][number] }) => Promise<T>, dependencies = sources): Promise<T> {
  const phone = requireCrewReady(request);
  const day = requireCrewDay(phone);
  const currentDispatch=readCrewDispatch(phone.truck).current;
  const current=currentDispatch?.assignmentId===assignmentId && currentDispatch.date===day.date ? currentDispatch : (()=>{
    const listed=dependencies.assignedDay(phone,day.date).jobs?.find(row=>row.assignmentId===assignmentId);
    return listed?{assignmentId,appointmentId:listed.appointmentId,date:day.date,releasedAt:new Date().toISOString()}:null;
  })();
  if (!current) throw new CrewPhoneError('This truck assignment changed. Refresh assignments.', 409);
  return withJunkwareAppointmentSyncLock(current.appointmentId, async () => {
    const assertScope = () => {
      const active = requireCrewReady(request);
      const stillListed=currentDispatch?.assignmentId===assignmentId
        ? readCrewDispatch(phone.truck).current?.assignmentId===assignmentId
        : dependencies.assignedDay(active,day.date).jobs?.some(row=>row.assignmentId===assignmentId && row.appointmentId===current.appointmentId);
      if (active.deviceId !== phone.deviceId || active.truck !== phone.truck || requireCrewDay(active).version !== day.version || !stillListed) throw new CrewPhoneError('Phone access or truck assignment changed. Contact dispatch.', 409);
    };
    assertScope();
    const source = await dependencies.assignment(current.appointmentId);
    if (source.appointmentId !== current.appointmentId || !sameTruck(source.truck,phone.truck) || source.date !== current.date || !/^(confirmed|completed)$/i.test(source.status || '')) throw new CrewPhoneError('This appointment is no longer assigned to this truck. Contact dispatch.', 409);
    const snapshot = dependencies.schedule(current.date);
    const matches = snapshot.appointments.filter(job => job.appointmentId === current.appointmentId && sameTruck(job.truck,phone.truck));
    if (!crewScheduleFresh(snapshot.observedAt) || matches.length !== 1 || (matches[0].junkwareSyncStatus && matches[0].junkwareSyncStatus !== 'verified')) throw new CrewPhoneError('The appointment source is unavailable. Contact dispatch.', 409);
    assertScope();
    const result = await run({ phone, current, job: matches[0] });
    assertScope();
    return result;
  });
}
