import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DesktopAppointment } from './desktop-schedule';
import { withJunkwareAppointmentSyncLock } from './job-route-assignments';
import { requestScheduleDay } from './requested-schedule-day';

export function validRescheduleDate(date: unknown): date is string {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0,10) === date;
}
export function rescheduleTarget(job: DesktopAppointment, date: string, values: Record<string, unknown>) {
  const start = values.appointmentStartMinutes;
  const duration = Number(job.appointmentEndMinutes) - Number(job.appointmentStartMinutes);
  if (!Number.isInteger(job.appointmentStartMinutes) || !Number.isInteger(job.appointmentEndMinutes)) throw new Error('A verified appointment window is required.');
  if (!validRescheduleDate(values.destinationDate) || typeof start !== 'number' || !Number.isInteger(start) || start < 0 || start % 60 || job.appointmentStartMinutes === null || job.appointmentEndMinutes === null || duration <= 0 || duration > 720 || duration % 60 || start + duration > 1440) throw new Error('A valid date and hourly appointment window are required.');
  if (values.destinationDate === date && start === job.appointmentStartMinutes) throw new Error('A different appointment date or time is required.');
  const match = job.truck.match(/^Truck\s*#?\s*(\d+)$/i);
  if (!match && !/^unassigned|virtual|^$|^—$/i.test(job.truck)) throw new Error('A verified truck assignment is required.');
  return { appointmentId: job.appointmentId, date: values.destinationDate, appointmentStartMinutes: start, appointmentEndMinutes: start + duration, truck: match ? `Truck ${match[1]}` : '' };
}

export async function rescheduleAppointment(job: DesktopAppointment, date: string, values: Record<string, unknown>) {
  const expected = rescheduleTarget(job, date, values);
  return withJunkwareAppointmentSyncLock(job.appointmentId, async () => {
    try {
      const { stdout } = await promisify(execFile)(process.execPath, ['--import','tsx',path.join(process.cwd(),'scripts/reschedule-junkware-appointment.ts'), '--appointment',job.appointmentId,'--date',expected.date,'--start-minutes',String(expected.appointmentStartMinutes),'--expected-date',date,'--expected-start-minutes',String(job.appointmentStartMinutes),'--expected-end-minutes',String(job.appointmentEndMinutes),'--expected-truck',expected.truck || 'unassigned'], {cwd:process.cwd(),timeout:180_000,maxBuffer:1024*1024,env:{...process.env}});
      const result = JSON.parse(stdout.trim());
      const matches = result.ok && result.mode === 'reschedule' && result.appointmentId === expected.appointmentId && result.date === expected.date && result.appointmentStartMinutes === expected.appointmentStartMinutes && result.appointmentEndMinutes === expected.appointmentEndMinutes && result.truck === expected.truck && Number.isFinite(Date.parse(result.verifiedAt));
      if (!matches) return {status:result.submitted === false ? 422 : 202, body:{ok:false,expected,error:result.error || 'JunkWare has not verified the reschedule. Do not submit it again.'}};
      // Collection is separate from the verified write. Never turn a refresh failure into a retryable write failure.
      try { requestScheduleDay(expected.date,null,false,true); requestScheduleDay(date,null,false,true); } catch { /* The normal Schedule refresh can retry collection. */ }
      return {status:200,body:{ok:true,expected,junkware:result}};
    } catch {
      return {status:202,body:{ok:false,expected,error:'The reschedule result is uncertain. Check Saved Result before another change.'}};
    }
  });
}
