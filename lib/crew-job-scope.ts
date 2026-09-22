import { sameTruck } from './junkware-trucks';
import { requireCrewReady } from './crew-phone-http';
import { requireCrewDay } from './crew-phone-day';
import { CrewPhoneError } from './crew-phone';
import { readCrewDispatch } from './crew-dispatch-store';
import { readDesktopSchedule } from './desktop-schedule';
import { crewScheduleFresh } from './crew-dispatch-service';
import { readJunkwareTruckAssignment } from './junkware-truck-assignment';
import { withJunkwareAppointmentSyncLock } from './job-route-assignments';

const sources = { schedule: readDesktopSchedule, assignment: readJunkwareTruckAssignment };
/** Resolve authority from the cookie and durable dispatch state, never a phone-supplied appointment. */
export async function withCrewJob<T>(request: Request, assignmentId: string,
  run: (scope: { phone: ReturnType<typeof requireCrewReady>; current: NonNullable<ReturnType<typeof readCrewDispatch>['current']>; job: ReturnType<typeof readDesktopSchedule>['appointments'][number] }) => Promise<T>, dependencies = sources): Promise<T> {
  const phone = requireCrewReady(request);
  const day = requireCrewDay(phone);
  const current = readCrewDispatch(phone.truck).current;
  if (!current || current.assignmentId !== assignmentId || current.date !== day.date) throw new CrewPhoneError('Dispatch changed. Refresh your assignment.', 409);
  return withJunkwareAppointmentSyncLock(current.appointmentId, async () => {
    const assertScope = () => {
      const active = requireCrewReady(request);
      if (active.deviceId !== phone.deviceId || active.truck !== phone.truck || requireCrewDay(active).version !== day.version || readCrewDispatch(phone.truck).current?.assignmentId !== assignmentId) throw new CrewPhoneError('Phone access or dispatch changed. Contact dispatch.', 409);
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
