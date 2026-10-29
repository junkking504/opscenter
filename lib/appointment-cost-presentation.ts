import type {AppointmentCostSummary} from './appointment-cost-model';

// One presentation rule for every register row. Older snapshots without subtotals
// remain unavailable; never manufacture a default cost after a source failure.
export function appointmentCostPresentation(summary:AppointmentCostSummary|null|undefined,kind:'To attend'|'Break-even') {
 const full=kind==='To attend'?summary?.attendance:summary?.breakEven;
 const missing=kind==='To attend'
  ? summary?.attendanceMissing??summary?.missing.filter(reason=>!reason.startsWith('Disposal')&&!reason.startsWith('On-site'))??[]
  : summary?.missing??[];
 if(full!=null)return {amount:full,incomplete:false,missing:[]};
 // Preserve the owner's existing disposal-only card subtotal convention.
 if(kind==='Break-even'&&missing.length===1&&missing[0].startsWith('Disposal')&&summary?.breakEvenBeforeDisposal!=null)
  return {amount:summary.breakEvenBeforeDisposal,incomplete:false,missing};
 const known=kind==='To attend'?summary?.attendanceKnownSubtotal:summary?.breakEvenKnownSubtotal;
 return {amount:known??null,incomplete:known!=null,missing};
}
