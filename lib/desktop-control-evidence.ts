import type { ControlItem } from '../desktop-ui/lib/control-contract';
import type { ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';

/** Current source evidence supplements a durable decision; it never silently resolves it. */
export function controlAppointmentEvidence(entity: ControlItem['entity'], schedule: {observedAt: string | null; appointments: ScheduleAppointment[]}) {
  if(entity.type!=='job')return undefined;
  const exact=schedule.appointments.filter(row=>row.recordId===entity.id||row.appointmentId===entity.id);
  const matches=exact.length?exact:schedule.appointments.filter(row=>row.jkNumber===entity.id||row.jkNumber===entity.label);
  if(!schedule.observedAt||matches.length!==1)return {status:'Current appointment evidence unavailable or ambiguous',observedAt:schedule.observedAt};
  return {status:matches[0].status||'Disposition unavailable',observedAt:schedule.observedAt};
}
