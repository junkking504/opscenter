import type {DesktopAppointment} from '@/lib/desktop-schedule';
import {sameTruck} from '@/lib/junkware-trucks';
export type ManagerContext = {date?:string;truck?:string;scroll?:number};
export const managerTerritory = (value:string) => value.replace(/^Junk King\s+/i,'').trim() || 'Territory unavailable';
export function managerStatus(status:string) {
 if (/cancel/i.test(status)) return 'Cancelled';
 if (/complet|closed/i.test(status)) return 'Completed';
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
