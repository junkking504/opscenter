import {prebookingCheck,prebookingSnapshotFresh,type PrebookingCheck} from './prebooking-duplicates';
import type {JunkwareAppointmentCreationInput} from './junkware-appointment-creation';
import type {ScheduleSnapshot} from '../desktop-ui/lib/schedule-contract';
import type {ScheduleSourceRequest} from './requested-schedule-day';

export function preparePrebookingReview(input:JunkwareAppointmentCreationInput,snapshot:Pick<ScheduleSnapshot,'date'|'observedAt'|'appointments'>,requestDay:(date:string,observedAt:string|null,hasRows:boolean,force:boolean)=>ScheduleSourceRequest,now=Date.now()):{check:PrebookingCheck}|{pending:true;message:string}|{error:string} {
  if(prebookingSnapshotFresh(input.date,snapshot,now))return {check:prebookingCheck(input,snapshot,now)};
  const result=requestDay(input.date,snapshot.observedAt,snapshot.appointments.length>0,true);
  if(result.state==='failed')return {error:'JunkWare could not check this date. Your booking details are saved. Try Review Booking again shortly.'};
  return {pending:true,message:'Checking the selected date in JunkWare… Your booking details are saved.'};
}
