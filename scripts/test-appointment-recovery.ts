import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DesktopAppointment } from '../lib/desktop-schedule';
async function main() {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ops-appointment-recovery-'));
  process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR=dir;
  process.env.JOB_ROUTE_ASSIGNMENTS_FILE=path.join(dir,'assignments.json');
  const {parseScheduleOperation,executeScheduleOperation,reconcileRescheduleReceipt,reconcileMoveReceipt}=await import('../lib/desktop-schedule-operations');
  const {saveJobRouteAssignment,readJobRouteAssignmentOverrides}=await import('../lib/job-route-assignments');
  const job={appointmentId:'1234',recordId:'2026-09-11:appointment:1234',version:'a'.repeat(64),status:'Canceled',appointmentStartMinutes:480,appointmentEndMinutes:540,truck:'Unassigned'} as DesktopAppointment;
  let writes=0;
  try {
    const op=parseScheduleOperation({requestId:randomUUID(),date:'2026-09-11',recordId:job.recordId,expectedVersion:job.version,action:'restore',values:{destinationDate:'2026-09-11',appointmentStartMinutes:480}});
    const expected={appointmentId:'1234',date:op.date,truck:'',appointmentStartMinutes:480,appointmentEndMinutes:540,status:'Confirmed'};
    const run=async()=>{writes++;return {status:202,body:{ok:false,expected}};};
    await assert.rejects(executeScheduleOperation(op,'tester',()=>({...job,status:'Confirmed'}),run),/Only canceled/);
    await assert.rejects(executeScheduleOperation(op,'tester',()=>({...job,version:'b'.repeat(64)}),run),/changed/);
    await executeScheduleOperation(op,'tester',()=>job,run);
    await executeScheduleOperation(op,'tester',()=>job,run);
    assert.equal(writes,1);
    await assert.rejects(executeScheduleOperation({...op,requestId:randomUUID()},'tester',()=>job,run),/unverified/);
    assert.equal((await reconcileRescheduleReceipt(op.requestId,'tester',async()=>({...expected,status:'Cancelled',verifiedAt:new Date().toISOString()})))?.status,'uncertain');
    assert.equal((await reconcileRescheduleReceipt(op.requestId,'tester',async()=>({...expected,verifiedAt:new Date().toISOString()})))?.status,'verified');
    for(const test of ['rejected','unknown','other-day','newer-override']) {
      const id=String(2000+['rejected','unknown','other-day','newer-override'].indexOf(test));
      const requestId=randomUUID();
      const pending=saveJobRouteAssignment({date:op.date,jobKey:`appt:${id}`,appointmentId:id,truck:'Truck 1',appointmentStartMinutes:660,appointmentEndMinutes:720,junkwareSyncStatus:'pending',junkwareSyncError:test==='unknown'?'Save response lost':'11:00 AM is not available for this JunkWare appointment.'})!;
      const receipt={requestId,actor:'tester',action:'move',date:op.date,recordId:`${op.date}:appointment:${id}`,status:'uncertain',fingerprint:'test',updatedAt:new Date().toISOString(),message:'Save not verified',sourceResult:{assignment:pending}};
      await fs.writeFile(path.join(dir,requestId+'.json'),JSON.stringify(receipt));
      if(test==='newer-override')saveJobRouteAssignment({...pending,truck:'Truck 3'});
      const source={appointmentId:id,date:test==='other-day'?'2026-09-12':op.date,truck:'Truck 1',appointmentStartMinutes:780,appointmentEndMinutes:840,verifiedAt:new Date().toISOString()};
      assert.equal(await reconcileMoveReceipt(requestId,'other',async()=>source),null);
      const resolved=await reconcileMoveReceipt(requestId,'tester',async()=>source);
      assert.equal(resolved?.status,test==='rejected'?'failed':'uncertain',test);
      if(test==='rejected') {
        assert.equal(resolved?.sourceResult?.assignmentReconciled,true);
        assert.equal((resolved?.sourceResult?.assignment as typeof pending).appointmentStartMinutes,660,'Retain attempted move in audit');
        assert.equal(readJobRouteAssignmentOverrides(op.date).get(`appt:${id}`)?.appointmentStartMinutes,780);
        assert.equal(readJobRouteAssignmentOverrides(op.date).get(`appt:${id}`)?.junkwareSyncStatus,'verified');
      }
    }
    assert.equal(writes,1,'Recovery never writes to JunkWare');
    console.log('Restore status/date validation, no duplicate submits, source status recovery, rejected-time reconciliation and conflicting/unknown source guards passed.');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
}
void main();
