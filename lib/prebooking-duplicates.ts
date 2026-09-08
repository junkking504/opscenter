import {createHash} from 'node:crypto';
import {addressKey, duplicateBookings} from '../desktop-ui/lib/duplicate-bookings';
import type {ScheduleAppointment, ScheduleSnapshot} from '../desktop-ui/lib/schedule-contract';
import type {JunkwareAppointmentCreationInput} from './junkware-appointment-creation';
import {serviceAddressForGeocoding} from './appointment-partner';

export type PrebookingCheck = {fingerprint:string; observedAt:string; matches:Array<Pick<ScheduleAppointment,'recordId'|'jkNumber'|'appointmentUrl'|'customerName'|'phone'|'address'|'appointmentTime'|'appointmentType'|'status'|'truck'|'territory'|'sourceTerritory'>>};
export class PrebookingReviewRequired extends Error {}
// Compare a street-only entry with a full source address only when ZIPs agree.
// Extra numbers or unit designators remain significant; never collapse units.
function sameAddress(draft:string, zip:string, source:string) {
  const a=addressKey(serviceAddressForGeocoding(draft)), b=addressKey(serviceAddressForGeocoding(source));
  if(!a||!b)return false;
  const sourceZip=source.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1];
  if(sourceZip && sourceZip!==zip.slice(0,5))return false;
  if(a===b)return true;
  if(sourceZip!==zip.slice(0,5))return false;
  const street=a.replace(/\s+\d{5}(?:\s+\d{4})?$/,'');
  if(!b.startsWith(street+' ')||!/\b(?:street|road|avenue|boulevard|lane|drive|court|way|highway|parkway|place|circle|trail|terrace)(?:\s+(?:unit|bldg|suite)\s+\w+)?$/.test(street))return false;
  const locality=b.slice(street.length).trim().replace(/\s+\d{5}(?:\s+\d{4})?$/,'');
  return /^[a-z ]+$/.test(locality)&&! /\b(?:unit|bldg|suite|floor|lot)\b/.test(locality);
}
export function prebookingCheck(input:JunkwareAppointmentCreationInput,snapshot:Pick<ScheduleSnapshot,'date'|'observedAt'|'appointments'>,now=Date.now()):PrebookingCheck {
  if(snapshot.date!==input.date||!snapshot.observedAt||!Number.isFinite(Date.parse(snapshot.observedAt))||now-Date.parse(snapshot.observedAt)>300_000||Date.parse(snapshot.observedAt)>now+60_000)throw new PrebookingReviewRequired('The selected day needs a fresh JunkWare snapshot. Refresh that date in Schedule, then review again.');
  const [hours,minutes]=input.startTime.split(':').map(Number), start=hours*60+minutes;
  const draft={recordId:input.date+':draft',appointmentId:'draft',jkNumber:'',customerName:input.firstName+' '+input.lastName,phone:input.phone,address:input.serviceAddress,hasScheduledTime:true,appointmentStartMinutes:start,appointmentEndMinutes:start+input.durationHours*60,status:'Confirmed',appointmentType:input.appointmentType,truck:input.truck,territory:input.franchise} as ScheduleAppointment;
  const candidates=snapshot.appointments.filter(job=>sameAddress(input.serviceAddress,input.serviceZip,job.address));
  const pairs=duplicateBookings([draft,...candidates.map(job=>({...job,address:input.serviceAddress}))]).filter(pair=>pair.jobs.some(job=>job.recordId===draft.recordId));
  const matches=pairs.map(pair=>snapshot.appointments.find(job=>job.recordId===pair.jobs.find(job=>job.recordId!==draft.recordId)!.recordId)!).sort((a,b)=>a.recordId.localeCompare(b.recordId)).map(job=>({recordId:job.recordId,jkNumber:job.jkNumber,appointmentUrl:job.appointmentUrl,customerName:job.customerName,phone:job.phone,address:job.address,appointmentTime:job.appointmentTime,appointmentType:job.appointmentType,status:job.status,truck:job.truck,territory:job.territory,sourceTerritory:job.sourceTerritory}));
  const {requestId:_,duplicateOverrideReason:__,...facts}=input;
  const fingerprint=createHash('sha256').update(JSON.stringify([facts,matches,pairs.map(pair=>pair.signature)])).digest('hex');
  return {fingerprint,observedAt:snapshot.observedAt,matches};
}
export function requirePrebookingReview(input:JunkwareAppointmentCreationInput,check:PrebookingCheck,ack:unknown) {
  if(!ack||typeof ack!=='object'||(ack as {fingerprint?:unknown}).fingerprint!==check.fingerprint)throw new PrebookingReviewRequired('Booking details or matching appointments changed. Review the appointment again before creating it.');
  if(check.matches.length&&((ack as {createSeparate?:unknown}).createSeparate!==true||input.duplicateOverrideReason.trim().length<10))throw new PrebookingReviewRequired('Review the matching appointments, choose to create a separate appointment, and enter a reason.');
}
