import type {DesktopAppointment} from '@/lib/desktop-schedule';
import {managerStatus} from './manager-presentation';

const money=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
type OutcomeRow=Pick<DesktopAppointment,'status'|'appointmentType'|'closeout'|'chargeDetailsPending'|'photos'|'photoAuditAvailable'>;

// Display only. Summary paymentAmount can be defaulted to zero by the source;
// use the existing closeout object and its freshness flag instead. Closeout
// numbers also default missing values to zero, so zero cannot prove availability.
export function managerOutcome(row:OutcomeRow) {
 const completed=managerStatus(row.status)==='Completed';
 const estimate=/^estimate$/i.test(row.appointmentType.trim());
 const closeout=!row.chargeDetailsPending?row.closeout:null;
 const knownTotal=closeout&&Number.isFinite(closeout.total)&&closeout.total!==0;
 const label=estimate?'Estimate total':'Job total';
 const total=completed?`${label}: ${knownTotal?money(closeout!.total):'unavailable'}`:null;
 const tip=knownTotal&&closeout&&Number.isFinite(closeout.tip)&&closeout.tip!==0?`Recorded tip: ${money(closeout.tip)}`:null;
 const payments=closeout?.payments.map(payment=>`${payment.method || 'Unspecified method'}: ${Number.isFinite(payment.amount)&&payment.amount!==0?money(payment.amount):'amount unavailable'}`) || [];
 const billed=closeout?.payments.some(payment=>/^billed\b/i.test(payment.method.trim()));
 const count=row.photos?.length || 0;
 const photos=count?`${count} recorded photo${count===1?'':'s'}${row.photoAuditAvailable?'':' · completeness unavailable'}`:row.photoAuditAvailable?'No photos recorded':'Photo count unavailable';
 return {total,tip:completed?tip:null,payments:completed?payments:[],notice:completed?(estimate?'Estimate only · not collected revenue':billed?'Billed entries are not collected payments':'Completion does not confirm payment'):null,photos,count};
}

export default function ManagerOutcome({job,details=false}:{job:OutcomeRow;details?:boolean}) {
 const outcome=managerOutcome(job);
 return <span>
  {outcome.total&&<strong>{outcome.total}</strong>}
  {outcome.tip&&<small>{outcome.tip}</small>}
  {outcome.notice&&<small>{outcome.notice}</small>}
  {details&&outcome.total&&<small>Recorded payment entries: {outcome.payments.length?outcome.payments.join(' · '):'unavailable'}</small>}
  <small>{outcome.photos}{outcome.count>0?' · viewing unavailable':''}</small>
  {details&&outcome.count>0&&<small>Photos cannot be opened securely in this manager view yet.</small>}
 </span>;
}
