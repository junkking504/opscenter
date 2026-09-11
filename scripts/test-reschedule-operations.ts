import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {DesktopAppointment} from '../lib/desktop-schedule';
async function main(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ops-reschedule-'));
  process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR=dir;
  process.env.JOB_ROUTE_ASSIGNMENTS_FILE=path.join(dir,'assignments.json');
  const {parseScheduleOperation,executeScheduleOperation,reconcileRescheduleReceipt}=await import('../lib/desktop-schedule-operations');
  const {rescheduleTarget}=await import('../lib/appointment-reschedule');
  const job={appointmentId:'1234',recordId:'2026-09-11:appointment:1234',version:'a'.repeat(64),status:'Confirmed',appointmentStartMinutes:480,appointmentEndMinutes:600,truck:'Truck 8'} as DesktopAppointment;
  const raw={requestId:randomUUID(),date:'2026-09-11',recordId:job.recordId,expectedVersion:job.version,action:'reschedule',values:{destinationDate:'2026-09-15',appointmentStartMinutes:600}};
  try {
    for(const destinationDate of ['2026-02-30','no','2026-13-01'])assert.throws(()=>parseScheduleOperation({...raw,values:{...raw.values,destinationDate}}),/required/);
    assert.throws(()=>parseScheduleOperation({...raw,values:{...raw.values,appointmentStartMinutes:610}}),/required/);
    assert.throws(()=>rescheduleTarget(job,raw.date,{...raw.values,appointmentStartMinutes:1380}),/required/);
    assert.throws(()=>rescheduleTarget(job,raw.date,{destinationDate:raw.date,appointmentStartMinutes:480}),/different/);
    const operation=parseScheduleOperation(raw),expected=rescheduleTarget(job,raw.date,operation.values);
    assert.equal(expected.appointmentEndMinutes,720);
    assert.equal(expected.truck,'Truck 8');
    let writes=0;
    const result=async()=>{writes++;return {status:202,body:{ok:false,expected}};};
    await assert.rejects(executeScheduleOperation(operation,'test',()=>({...job,status:'Canceled'}),result),/Canceled/);
    await assert.rejects(executeScheduleOperation(operation,'test',()=>({...job,status:'Completed'}),result),/Closed/);
    await assert.rejects(executeScheduleOperation(operation,'test',()=>({...job,junkwareSyncStatus:'pending'}),result),/unverified/);
    await Promise.all([1,2].map(()=>executeScheduleOperation(operation,'test',()=>job,result)));
    assert.equal(writes,1);
    await assert.rejects(executeScheduleOperation({...operation,requestId:randomUUID()},'test',()=>job,result),/unverified/);
    const saved={...expected,verifiedAt:new Date().toISOString()};
    assert.equal((await reconcileRescheduleReceipt(operation.requestId,'test',async()=>({...saved,date:'2026-09-14'})))?.status,'uncertain');
    assert.equal((await reconcileRescheduleReceipt(operation.requestId,'test',async()=>saved))?.status,'verified');
    assert.equal(writes,1);
    console.log('Reschedule operation validation, duration/truck preservation, locks, closed/pending guards and exact read-only recovery passed.');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
void main();
