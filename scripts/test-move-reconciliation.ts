import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {DesktopAppointment} from '../lib/desktop-schedule';
async function main(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'move-reconcile-'));
 process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR=path.join(dir,'receipts');
 process.env.JOB_ROUTE_ASSIGNMENTS_FILE=path.join(dir,'assignments.json');
 const {executeScheduleOperation,reconcileMoveReceipt,readPendingScheduleReceipt}=await import('../lib/desktop-schedule-operations');
 const {saveJobRouteAssignment,readJobRouteAssignmentOverrides}=await import('../lib/job-route-assignments');
 try {
  const date='2026-09-10',appointmentId='1234';
  const job={recordId:`${date}:appointment:${appointmentId}`,appointmentId,version:'a'.repeat(64),status:'Confirmed'} as DesktopAppointment;
  const assignment=saveJobRouteAssignment({date,jobKey:'appt:1234',appointmentId,truck:'Truck 3',appointmentStartMinutes:660,appointmentEndMinutes:720,junkwareSyncStatus:'pending'})!;
  const requestId=randomUUID();
  await executeScheduleOperation({requestId,date,recordId:job.recordId,expectedVersion:job.version,action:'move',values:{truck:'Truck 3',appointmentStartMinutes:660,durationHours:1}},'tester',()=>job,async()=>({status:202,body:{assignment}}));
  const source={appointmentId,date,truck:'Truck 3',appointmentStartMinutes:660,appointmentEndMinutes:720,verifiedAt:new Date().toISOString()};
  assert.equal(await reconcileMoveReceipt(requestId,'other',async()=>{throw Error('Must not read');}),null);
  assert.equal((await reconcileMoveReceipt(requestId,'tester',async()=>{throw Error('Unavailable');}))?.status,'uncertain');
  for(const mismatch of [{date:'2026-09-11'},{truck:'Truck 9'},{appointmentStartMinutes:780,appointmentEndMinutes:840},{appointmentEndMinutes:780}]) {
   const result=await reconcileMoveReceipt(requestId,'tester',async()=>({...source,...mismatch}));
   assert.equal(result?.status,'uncertain');assert.match(result!.message,/Earlier assignment change/);
   assert.equal(readJobRouteAssignmentOverrides(date).get('appt:1234')?.junkwareSyncStatus,'pending');
  }
  saveJobRouteAssignment({...assignment,truck:'Truck 4'});
  assert.equal((await reconcileMoveReceipt(requestId,'tester',async()=>source))?.status,'uncertain','Do not overwrite a newer local plan');
  saveJobRouteAssignment(assignment);
  const verified=await reconcileMoveReceipt(requestId,'tester',async()=>source);
  assert.equal(verified?.status,'verified');assert.equal(verified?.action,'move');
  assert.equal(readJobRouteAssignmentOverrides(date).get('appt:1234')?.junkwareSyncStatus,'verified');
  assert.equal(await readPendingScheduleReceipt(job.recordId),null,'Exact source match releases the stale blocker');
  assert.equal((await reconcileMoveReceipt(requestId,'tester',async()=>{throw Error('Do not reread terminal receipt');}))?.status,'verified');
  console.log('Move reconciliation passed: actor isolation, unavailable/mismatched source, newer local plan, exact verified readback and no replay. Synthetic only.');
 } finally {await fs.rm(dir,{recursive:true,force:true});}
}
void main();
