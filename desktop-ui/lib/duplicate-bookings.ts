import { isClosed, type ScheduleAppointment } from './schedule-contract';

export type DuplicatePair = { key: string; signature: string; jobs: [ScheduleAppointment, ScheduleAppointment]; reason: string };
export type DuplicateDecision = { state: 'keep_both' | 'review'; actor: string; at: string; revision: string };
export type DuplicateReview = { key: string; signature: string; fingerprint: string; decision: DuplicateDecision | null };
const words = (value: string) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const validName = (value: string) => value.length >= 3 && !/^(?:unknown|unavailable|customer unavailable|customer|anonymous)$/.test(value);
function addressKey(value: string) {
  const key = words(value).replace(/\b(?:st|rd|ave|blvd|ln|dr|ct|apt|apartment|building)\b/g, token => ({st:'street',rd:'road',ave:'avenue',blvd:'boulevard',ln:'lane',dr:'drive',ct:'court',apt:'unit',apartment:'unit',building:'bldg'}[token]!));
  // A missing address, street without a number, or placeholder is not a match.
  return /^\d+\w*\s+\S/.test(key) && key.length >= 12 ? key : '';
}
const phoneKey = (value: string) => { const digits=String(value||'').replace(/\D/g,''); return /^(?:1)?\d{10}$/.test(digits) && !/^0+$/.test(digits) ? digits.slice(-10) : ''; };
function facts(job: ScheduleAppointment) {
  // Deliberately ignore GPS, collection timestamps and unrelated note edits.
  return [job.recordId,job.appointmentId,job.jkNumber,words(job.customerName),phoneKey(job.phone),addressKey(job.address),job.appointmentStartMinutes,job.appointmentEndMinutes,job.hasScheduledTime,job.appointmentType,job.status,job.truck,job.sourceTerritory||job.territory,job.sourceEstimateAppointmentId];
}
export function duplicateBookings(jobs: ScheduleAppointment[]): DuplicatePair[] {
  const rows=[...jobs].filter(j=>j.appointmentId && !/cancel/i.test(j.status) && j.hasScheduledTime && j.appointmentStartMinutes!==null && j.appointmentEndMinutes!==null && j.appointmentEndMinutes>j.appointmentStartMinutes).sort((a,b)=>a.recordId.localeCompare(b.recordId));
  const result: DuplicatePair[]=[];
  for(let i=0;i<rows.length;i++) for(let n=i+1;n<rows.length;n++) {
    const a=rows[i],b=rows[n];
    if(a.appointmentId===b.appointmentId || a.recordId.split(':')[0]!==b.recordId.split(':')[0] || isClosed(a)&&isClosed(b))continue;
    if(a.sourceEstimateAppointmentId===b.appointmentId || b.sourceEstimateAppointmentId===a.appointmentId)continue;
    if(a.appointmentStartMinutes!>=b.appointmentEndMinutes! || b.appointmentStartMinutes!>=a.appointmentEndMinutes!)continue;
    const address=addressKey(a.address); if(!address || address!==addressKey(b.address))continue;
    const name=words(a.customerName), phone=phoneKey(a.phone);
    const sameName=validName(name)&&name===words(b.customerName), samePhone=Boolean(phone&&phone===phoneKey(b.phone));
    if(!sameName&&!samePhone)continue;
    result.push({key:JSON.stringify([a.recordId,b.recordId]),signature:JSON.stringify([facts(a),facts(b)]),jobs:[a,b],reason:`Same service address · Matching ${sameName?'customer':'phone'} · Overlapping windows`});
  }
  return result;
}
