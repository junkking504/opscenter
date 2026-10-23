import assert from 'node:assert/strict';
import {job} from './fixtures/crew-progress';
import {mergeFastScheduleRows,separateCancellationContact} from '../lib/desktop-schedule-source';
import {managerSections,managerStatus,managerTerritory,unresolvedManagerReceipt} from '../app/crew-jobs/manager-presentation';
import type {DesktopAppointment} from '../lib/desktop-schedule';
const date='2026-10-23';
for(const reason of ['Got confirmation from another vendor.','Too expensive.','Changed plans.','No longer needed.']) {
 for(const phone of ['5045550100','(504) 555-0100','+1 504-555-0100']) {
  const raw=`Example Customer ${phone} 100 Example Street New Orleans, LA 70115 ${reason} Followup`;
  const source=job({status:'Cancelled by Example Operator',customerName:raw,phone:'5045550100',address:'100 Example Street, New Orleans, LA 70115',cancellationReason:raw,appointmentNotes:['Original scope\nSecond line',raw]});
  const before=structuredClone(source),clean=separateCancellationContact(source);
  assert.equal(clean.customerName,'Example Customer');assert.equal(clean.cancellationReason,reason);
  assert.deepEqual(clean.appointmentNotes.slice(0,2),source.appointmentNotes,'Raw notes remain verbatim');assert.deepEqual(source,before,'No authoritative record mutation');
  const merged=mergeFastScheduleRows([job({...source,customerName:'Preferred Customer',appointmentId:'1'}),job({appointmentId:'2',customerName:'Different Visit'})],[],[{appt_id:'1',job_id:source.jkNumber,customer_name:raw,job_status:source.status,cancellation_reason:raw,phone:'5045550100',address:source.address}],date);
  assert.equal(merged.length,1);assert.equal(merged[0].customerName,'Preferred Customer','Matching detailed identity outranks a contaminated fast cell');
  assert.equal(merged[0].cancellationReason,reason);assert.equal(merged[0].appointmentId,'1');
 }
}
for(const name of ['Studio 54','Example & Sons LLC','Example Customer']) {
 const source=job({customerName:name,status:'Cancelled',cancellationReason:'Changed plans.'});assert.equal(separateCancellationContact(source).customerName,name);
 const active={...source,status:'Confirmed',customerName:'Keep 5045550100 100 Example Street'};assert.equal(separateCancellationContact(active),active);
}
const onlyFast=mergeFastScheduleRows([],[],[{appt_id:'99',job_id:'JK-SAMPLE',customer_name:'New Customer 5045550100 100 Example Street New Orleans, LA 70115 Too expensive. Followup',job_status:'Cancelled',cancellation_reason:'Too expensive.'}],date)[0];
assert.equal(separateCancellationContact(onlyFast).customerName,'New Customer','No detailed record still projects the name from the contact boundary');
const row=(id:string,status:string,start:number|null,truck='Truck 4')=>({...job({status,appointmentStartMinutes:start,truck}),recordId:id,jkNumber:id,version:'v',callAhead:'not_called',location:null}) as DesktopAppointment;
const rows=[row('c','Cancelled by Example',600,'—'),row('z','Completed Duration: 60 min(s)',900),row('a','Completed',480,'Truck# 6'),row('u','Confirmed',null),row('s','Scheduled',540),row('x','Canceled',480)];
const before=structuredClone(rows),sections=managerSections(rows);
assert.deepEqual(sections.map(s=>[s.id,s.rows.map(r=>r.recordId)]),[['active',['s','u']],['completed',['a','z']],['cancelled',['x','c']]]);
assert.deepEqual(managerSections(rows,'Truck# 4').map(s=>s.rows.length),[2,1,1]);assert.deepEqual(managerSections(rows,'unassigned').map(s=>s.rows.length),[0,0,1]);assert.deepEqual(rows,before);
assert.equal(managerStatus('Completed Duration: 60 min(s)'),'Completed');assert.equal(managerTerritory('Junk King Baton Rouge'),'Baton Rouge');
for(const status of ['pending','uncertain','submitted',undefined])assert.ok(unresolvedManagerReceipt({status}));
for(const status of ['verified','failed','reconciled'])assert.equal(unresolvedManagerReceipt({status}),false);
console.log('PASS manager presentation: cancellation contact variants, detailed identity precedence, raw notes/source immutability, fast-only records, chronological status groups, truck aliases, unknown times and receipt states.');
