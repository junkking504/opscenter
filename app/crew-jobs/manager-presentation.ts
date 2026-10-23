import type {DesktopAppointment} from '@/lib/desktop-schedule';
import {sameTruck} from '@/lib/junkware-trucks';
export type ManagerContext = {date?:string;truck?:string;scroll?:number};
export const managerTerritory = (value:string) => value.replace(/^Junk King\s+/i,'').trim() || 'Territory unavailable';
export function managerStatus(status:string) {
 if (/^cancel(?:led|ed)\b/i.test(status.trim())) return 'Cancelled';
 if (/^(?:completed|closed)\b/i.test(status.trim())) return 'Completed';
 return status.replace(/\s*Duration:.*$/i,'').trim() || 'Status unavailable';
}
export function managerSections(rows:DesktopAppointment[],truck='') {
 const visible=rows.filter(row=>!truck || (truck==='unassigned' ? !row.truck || /^(?:—|unassigned)$/i.test(row.truck) : sameTruck(row.truck,truck)));
 return [
  {id:'active',label:'Active / Scheduled',rows:visible.filter(row=>!['Cancelled','Completed'].includes(managerStatus(row.status)))},
  {id:'completed',label:'Completed',rows:visible.filter(row=>managerStatus(row.status)==='Completed')},
  {id:'cancelled',label:'Cancelled',rows:visible.filter(row=>managerStatus(row.status)==='Cancelled')},
 ].map(section=>({...section,rows:section.rows.sort((a,b)=>(a.appointmentStartMinutes ?? Infinity)-(b.appointmentStartMinutes ?? Infinity) || (a.appointmentEndMinutes ?? Infinity)-(b.appointmentEndMinutes ?? Infinity) || a.jkNumber.localeCompare(b.jkNumber,undefined,{numeric:true}) || a.recordId.localeCompare(b.recordId))}));
}
export const unresolvedManagerReceipt = (receipt:{status?:string}|null) => Boolean(receipt && !['verified','failed','reconciled'].includes(receipt.status || ''));

// Display-only projection. Never mutate the source appointment or its notes.
export function managerAppointmentDisplay(row:Pick<DesktopAppointment,'customerName'|'phone'|'address'|'status'|'cancellationReason'>) {
 const original={customerName:row.customerName,cancellationReason:row.cancellationReason};
 if(managerStatus(row.status)!=='Cancelled')return original;
 const raw=row.customerName.trim();
 // Require a complete phone followed by a numbered street, not digits in a name.
 const contactPattern=/\s+(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}\s+(?=\d+\s)/;
 const contact=raw.match(contactPattern);
 const customerName=contact&&contact.index?raw.slice(0,contact.index).trim():row.customerName;
 let reason=row.cancellationReason || (contact?raw:'');
 const reasonContact=reason.match(contactPattern);
 if(!reasonContact)return {customerName,cancellationReason:reason || 'Cancellation reason unavailable'};
 const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
 reason=reason.replace(new RegExp(`^${escape(customerName)}\\s+`,'i'),'');
 const knownDigits=row.phone.replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
 const digits=knownDigits.length===10?knownDigits:(reasonContact[0] || '').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');
 if(digits.length===10)reason=reason.replace(new RegExp(`^(?:\\+?1[\\s().-]*)?\\(?${digits.split('').join('[\\s().+-]*')}[)\\s.-]*`,'i'),'');
 const address=row.address.match(/^(.+?),\s*([^,]+?)(?:,\s*([A-Z]{2}))?\s*,?\s*(\d{5}(?:-\d{4})?)$/i);
 if(address){const [,street,city,state,zip]=address;reason=reason.replace(new RegExp(`^${escape(street)}\\s*,?\\s*${escape(city)}\\s*,?\\s*${state?`${escape(state)}\\s*,?\\s*`:'(?:[A-Z]{2}\\s*,?\\s*)?'}${escape(zip)}\\s*`,'i'),'');}
 reason=reason.replace(/\s+Followup\.?$/i,'').trim();
 return {customerName,cancellationReason:reason || row.cancellationReason || 'Cancellation reason unavailable'};
}
