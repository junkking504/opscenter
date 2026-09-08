import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { duplicateBookings } from '../desktop-ui/lib/duplicate-bookings';
import type { ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';
import { readDuplicateReviews, saveDuplicateReview } from '../lib/duplicate-booking-reviews';
const date='2026-09-08';
const job=(id:string,patch:Partial<ScheduleAppointment>={})=>({recordId:date+':appointment:'+id,appointmentId:id,jkNumber:'JK10000'+id,address:'100 Example Rd Unit 1, Greenwell Springs, LA 70739',customerName:'Sample Customer',phone:'(225) 555-0100',truck:'Truck 1',territory:'New Orleans',appointmentType:'Job',status:'Confirmed',hasScheduledTime:true,appointmentStartMinutes:720,appointmentEndMinutes:780,...patch} as ScheduleAppointment);
const a=job('1'),b=job('2',{territory:'Baton Rouge',truck:'Truck 2'});
const pair=duplicateBookings([a,b])[0];assert.ok(pair);
assert.deepEqual(duplicateBookings([b,a]),[pair],'Pair identity is order-independent');
for(const patch of [{address:'100 Example Rd Unit 2, Greenwell Springs, LA 70739'},{address:''},{customerName:'Different Person',phone:'2255550123'},{status:'Cancelled by operator'},{appointmentStartMinutes:780,appointmentEndMinutes:840},{hasScheduledTime:false},{appointmentId:'1'},{recordId:'2026-09-09:appointment:2'},{sourceEstimateAppointmentId:'1'}])assert.equal(duplicateBookings([a,{...b,...patch}]).length,0,JSON.stringify(patch));
assert.equal(duplicateBookings([{...a,status:'Completed'},b]).length,1,'Warn if a second open booking overlaps already completed work');
assert.equal(duplicateBookings([{...a,status:'Completed'},{...b,status:'Completed'}]).length,0);
assert.equal(duplicateBookings([a,{...b,appointmentType:'Estimate'}]).length,1,'Different types are visible for review, never merged');
assert.equal(duplicateBookings([a,{...b,jkNumber:a.jkNumber}]).length,1,'JK alone is not appointment identity');
assert.equal(duplicateBookings([a,{...b,address:a.address.replace('Rd','Road').replace('Unit','Apartment')}]).length,1);
assert.equal(duplicateBookings([{...a,customerName:'Unknown',phone:''},{...b,customerName:'Unknown',phone:''}]).length,0);
assert.equal(duplicateBookings([{...a,address:'Example Road'},{...b,address:'Example Road'}]).length,0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ops-duplicate-reviews-'));
process.env.OPSCENTER_DUPLICATE_REVIEWS_DIR=root;
try {
  const jobs=[a,b],before=JSON.stringify(jobs);
  const initial=readDuplicateReviews(date,jobs)[0];
  const input={date,key:initial.key,fingerprint:initial.fingerprint,state:'keep_both' as const,expectedRevision:null};
  const saved=saveDuplicateReview(input,'test-operator',()=>jobs);
  assert.equal(readDuplicateReviews(date,jobs)[0].decision?.state,'keep_both');
  assert.equal(readDuplicateReviews(date,[{...a,version:'new',location:{latitude:30,longitude:-90}},b])[0].decision?.state,'keep_both','GPS and collector refreshes do not erase review');
  for(const patch of [{customerName:'Changed Customer'},{address:a.address.replace('Unit 1','Unit 2')},{truck:'Truck 9'},{appointmentType:'Estimate'},{appointmentEndMinutes:790},{territory:'Lafayette'},{phone:'2255550123'}]) {
    const changed=[{...a,...patch},b];
    assert.ok(readDuplicateReviews(date,changed).every(r=>r.decision===null));
    assert.throws(()=>saveDuplicateReview(input,'test-operator',()=>changed),/changed/);
  }
  assert.throws(()=>saveDuplicateReview(input,'second-operator',()=>jobs),/Another operator/);
  const reopened=saveDuplicateReview({...input,state:'review',expectedRevision:saved.decision.revision},'test-operator',()=>jobs);
  assert.equal(reopened.decision.state,'review');
  assert.equal(readDuplicateReviews(date,jobs)[0].decision?.revision,reopened.decision.revision);
  assert.equal(JSON.stringify(jobs),before,'Decisions never change bookings or assignments');
  const record=fs.readdirSync(root).find(file=>file.endsWith('.json'))!;
  fs.writeFileSync(path.join(root,record),'invalid');
  assert.throws(()=>readDuplicateReviews(date,jobs),'Unreadable storage fails visibly instead of pretending decisions loaded');
  console.log('Duplicate booking checks passed: conservative matching, distinct identities, canceled/linked/closed exclusions, durable read-back, invalidation, concurrent review guard, reopen, and no appointment writes.');
} finally {delete process.env.OPSCENTER_DUPLICATE_REVIEWS_DIR;fs.rmSync(root,{recursive:true,force:true});}
