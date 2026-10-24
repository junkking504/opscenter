import assert from 'node:assert/strict';
import {job} from './fixtures/crew-progress';
import {managerAppointmentDisplay,managerSections,managerStatus,managerTerritory,unresolvedManagerReceipt} from '../app/crew-jobs/manager-presentation';
import type {DesktopAppointment} from '../lib/desktop-schedule';
const date='2026-10-23';
for(const reason of ['Got confirmation from another vendor.','Too expensive.','Changed plans.','No longer needed.']) {
 for(const phone of ['5045550100','(504) 555-0100','+1 504-555-0100']) {
  const raw=`Example Customer ${phone} 100 Example Street New Orleans, LA 70115 ${reason} Followup`;
  const source=job({status:'Cancelled by Example Operator',customerName:raw,phone:'5045550100',address:'100 Example Street, New Orleans, LA 70115',cancellationReason:raw,appointmentNotes:['Original scope\nSecond line',raw]});
  const before=structuredClone(source),clean=managerAppointmentDisplay(source);
  assert.equal(clean.customerName,'Example Customer');assert.equal(clean.cancellationReason,reason);
  assert.deepEqual(source,before,'Display projection preserves every raw source field and note');

 }
}
for(const name of ['Studio 54','Example & Sons LLC','Example Customer']) {
 const source=job({customerName:name,status:'Cancelled',cancellationReason:'Changed plans.'});assert.equal(managerAppointmentDisplay(source).customerName,name);
 const active={...source,status:'Confirmed',customerName:'Keep 5045550100 100 Example Street'};assert.equal(managerAppointmentDisplay(active).customerName,active.customerName);
}
assert.equal(managerAppointmentDisplay(job({customerName:'No',status:'Cancelled',cancellationReason:'No longer needed.'})).cancellationReason,'No longer needed.');
const missingPhone=job({customerName:'Example Customer 5045550100 100 Example Street New Orleans, LA 70115 Changed plans. Followup',phone:'—',address:'100 Example Street, New Orleans, LA 70115',status:'Cancelled',cancellationReason:'Example Customer 5045550100 100 Example Street New Orleans, LA 70115 Changed plans. Followup'});assert.equal(managerAppointmentDisplay(missingPhone).cancellationReason,'Changed plans.');
const row=(id:string,status:string,start:number|null,truck='Truck 4')=>({...job({status,appointmentStartMinutes:start,truck}),recordId:id,jkNumber:id,version:'v',callAhead:'not_called',location:null}) as DesktopAppointment;
const rows=[row('c','Cancelled by Example',600,'—'),row('z','Completed Duration: 60 min(s)',900),row('a','Completed',480,'Truck# 6'),row('u','Confirmed',null),row('s','Scheduled',540),row('x','Canceled',480)];
const before=structuredClone(rows),sections=managerSections(rows);
assert.deepEqual(sections.map(s=>[s.id,s.rows.map(r=>r.recordId)]),[['active',['s','u']],['completed',['a','z']],['cancelled',['x','c']]]);
assert.deepEqual(managerSections(rows,'Truck# 4').map(s=>s.rows.length),[2,1,1]);assert.deepEqual(managerSections(rows,'unassigned').map(s=>s.rows.length),[0,0,1]);assert.deepEqual(rows,before);
assert.equal(managerStatus('Completed Duration: 60 min(s)'),'Completed');assert.equal(managerStatus('Incomplete'),'Incomplete');assert.equal(managerStatus('Not completed'),'Not completed');assert.equal(managerStatus('Cancellation requested'),'Cancellation requested');assert.equal(managerTerritory('Junk King Baton Rouge'),'Baton Rouge');
for(const status of ['pending','uncertain','submitted',undefined])assert.ok(unresolvedManagerReceipt({status}));
for(const status of ['verified','failed','reconciled'])assert.equal(unresolvedManagerReceipt({status}),false);
console.log('PASS manager presentation: display-only cancellation contact variants, raw notes/source immutability, unchanged non-cancelled names, chronological status groups, truck aliases, unknown times and receipt states.');

import {managerOutcome} from '../app/crew-jobs/manager-outcome';
const completed=job(),raw=structuredClone(completed);
assert.equal(managerOutcome(completed).total,'Job total: $450.00');
assert.equal(managerOutcome(completed).notice,'Completion does not confirm payment');
assert.deepEqual(managerOutcome(completed).payments,['Cash: $450.00']);
assert.equal(managerOutcome({...completed,appointmentType:'Estimate'}).notice,'Estimate only · not collected revenue');
assert.equal(managerOutcome({...completed,appointmentType:'Estimate'}).total,'Estimate total: $450.00');
for(const closeout of [null,{...completed.closeout!,total:NaN},{...completed.closeout!,total:Infinity}])assert.equal(managerOutcome({...completed,closeout}).total,'Job total: unavailable');
assert.equal(managerOutcome({...completed,chargeDetailsPending:true}).total,'Job total: unavailable');
assert.equal(managerOutcome({...completed,closeout:{...completed.closeout!,total:0}}).total,'Job total: $0.00');
const billed={...completed,closeout:{...completed.closeout!,total:538,tip:38,payments:[{method:'Billed',detail:'',amount:400},{method:'Cash',detail:'',amount:138}]}};
assert.equal(managerOutcome(billed).total,'Job total: $538.00');assert.equal(managerOutcome(billed).tip,'Includes $38.00 tip');
assert.equal(managerOutcome(billed).notice,'Billed entries are not collected payments');
assert.deepEqual(managerOutcome(billed).payments,['Billed: $400.00','Cash: $138.00']);
assert.equal(managerOutcome({...completed,status:'Confirmed'}).total,null);
assert.equal(managerOutcome({...completed,status:'Cancelled'}).total,null);
assert.equal(managerOutcome(completed).photos,'No photos recorded');
assert.equal(managerOutcome({...completed,photoAuditAvailable:false}).photos,'Photo count unavailable');
const photos=[{url:'https://example.invalid/private.jpg',fileName:'fictional.jpg',category:'Before' as const}];
assert.equal(managerOutcome({...completed,photos}).photos,'1 recorded photo');
assert.equal(managerOutcome({...completed,photos,photoAuditAvailable:false}).photos,'1 recorded photo · completeness unavailable');
assert.deepEqual(completed,raw,'Amounts and photo presentation never mutate source values');
console.log('PASS manager amounts/photos: jobs, estimates, billed/mixed payment entries, included tip, missing/pending/nonfinite totals, explicit zero, audited/unknown photo counts and source immutability.');
