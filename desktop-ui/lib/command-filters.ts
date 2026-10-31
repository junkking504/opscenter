import { appointmentStatus, isClosed, scheduleDisplayTruck, needsScheduleMapLocation, type ScheduleAppointment } from './schedule-contract';

export function commandDone(job: ScheduleAppointment) {
  return ['Completed', 'Estimate Closed'].includes(appointmentStatus(job));
}

export function commandAttention(job: ScheduleAppointment) {
  return !isClosed(job) && (scheduleDisplayTruck(job) === 'Unassigned' || needsScheduleMapLocation(job));
}
