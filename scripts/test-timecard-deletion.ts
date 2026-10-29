import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {executeTimecardDelete,type TimecardDeleteAdapter} from '../lib/timecard-delete-execution';
import {saveTimecardDelete,readTimecardDelete,correctionVersion,correctionWasDeleted,assertNoTimecardDeletion,type TimecardDeleteReceipt} from '../lib/timecard-deletions';
import {upsertPayrollCorrection,payrollCorrectionForEmployee} from '../lib/payroll-corrections';
import {appliedPayrollCorrectionForEmployee} from '../lib/applied-payroll-corrections';
import {acquirePayrollEmployeeLock} from './payroll-employee-lock';
import {opsRoleCan,requiredOpsPermission} from '../lib/ops-roles';
import type {JunkwareShift} from '../lib/junkware-payroll-sync';
const previous=process.env.OPSBOT_DATA_DIR,dir=fs.mkdtempSync(path.join(os.tmpdir(),'timecard-delete-'));process.env.OPSBOT_DATA_DIR=dir;
const shift:JunkwareShift={workDate:'2026-10-28',clockIn:'07:00 AM',clockOut:'03:00 PM',hourlyRate:20,hours:8,regularHours:8,overtimeHours:0,labor:160};
function setup(name?:string,expiresAt=new Date(Date.now()+300000).toISOString()){const id=randomUUID(),now=new Date().toISOString();const row:TimecardDeleteReceipt={id,actor:'manager@example.invalid',employeeName:name||`Synthetic ${id}`,workDate:shift.workDate,employeeId:'123',marketId:'456',createdAt:now,updatedAt:now,expiresAt,status:'preview',message:'Preview',before:shift,correctionVersion:correctionVersion(payrollCorrectionForEmployee(shift.workDate,name||`Synthetic ${id}`))};saveTimecardDelete(row);let source:JunkwareShift|null=structuredClone(shift),submits=0;const adapter:TimecardDeleteAdapter={read:async()=>source,prepare:async()=>{},reload:async()=>{},assertCurrent:()=>{},submit:async()=>{assert.equal(readTimecardDelete(id)?.status,'submitted');assert.deepEqual(readTimecardDelete(id)?.before,shift);submits++;source=null;}};return {row,adapter,get source(){return source;},set source(value){source=value;},get submits(){return submits;}};}
async function main(){try{
 const happy=setup();const good=await executeTimecardDelete(happy.row,happy.adapter);assert.equal(good.status,'verified');assert.equal(happy.submits,1);assert.deepEqual(readTimecardDelete(good.id)?.history?.map(x=>x.status),['preview','submitted','verified']);await executeTimecardDelete(good,happy.adapter);assert.equal(happy.submits,1);
 const cancel=setup();assert.equal((await executeTimecardDelete(cancel.row,cancel.adapter,true)).status,'preview');assert.equal(cancel.submits,0);
 const stale=setup();stale.source={...shift,clockIn:'08:00 AM'};assert.equal((await executeTimecardDelete(stale.row,stale.adapter)).status,'failed');assert.equal(stale.submits,0);
 const multi=setup();multi.adapter.read=async()=>{throw Error('Multiple shifts');};assert.equal((await executeTimecardDelete(multi.row,multi.adapter)).status,'failed');assert.equal(multi.submits,0);
 const editor=setup();editor.adapter.prepare=async()=>{throw Error('Native editor changed');};assert.equal((await executeTimecardDelete(editor.row,editor.adapter)).status,'failed');assert.equal(editor.submits,0);
 const expired=setup(undefined,new Date(0).toISOString());assert.equal((await executeTimecardDelete(expired.row,expired.adapter)).status,'failed');assert.equal(expired.submits,0);
 const lost=setup();const submit=lost.adapter.submit;lost.adapter.submit=async()=>{await submit();throw Error('Lost response');};assert.equal((await executeTimecardDelete(lost.row,lost.adapter)).status,'verified');assert.equal(lost.submits,1);
 const uncertain=setup();let attempts=0;uncertain.adapter.submit=async()=>{attempts++;throw Error('Unknown');};const pending=await executeTimecardDelete(uncertain.row,uncertain.adapter);assert.equal(pending.status,'uncertain');assert.throws(()=>assertNoTimecardDeletion(pending.workDate,pending.employeeName),/unconfirmed/);await executeTimecardDelete(pending,uncertain.adapter);assert.equal(attempts,1);uncertain.source=null;assert.equal((await executeTimecardDelete(pending,uncertain.adapter,true)).status,'verified');assert.equal(attempts,1);
 const changed=setup();changed.adapter.submit=async()=>{changed.source={...shift,clockOut:'04:00 PM'};};assert.equal((await executeTimecardDelete(changed.row,changed.adapter)).status,'uncertain','Never equate changed entry with absence');
 const audit=setup();await assert.rejects(()=>executeTimecardDelete(audit.row,audit.adapter,false,()=>{throw Error('Disk unavailable');}),/Disk/);assert.equal(audit.submits,0);
 const correction=upsertPayrollCorrection({employeeName:'Synthetic Original',workDate:shift.workDate,clockIn:shift.clockIn,clockOut:shift.clockOut,hourlyRate:20,note:'Synthetic',updatedBy:good.actor})!;const corrected=setup('Synthetic Original');await executeTimecardDelete(corrected.row,corrected.adapter);assert.equal(correctionWasDeleted(correction),true);assert.equal(appliedPayrollCorrectionForEmployee(shift.workDate,correction.employeeName),null,'A verified source deletion must not be resurrected by a local override');assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'payroll_corrections/payroll_corrections.json'),'utf8')).corrections.length,1,'Preserve audit/source correction, not erase history');assert.throws(()=>saveTimecardDelete({...good,before:{...shift,clockIn:'08:00 AM'}}),/audit identity/);
 const release=acquirePayrollEmployeeLock('Synthetic Lock');assert.throws(()=>acquirePayrollEmployeeLock('Synthetic Lock'),/still running/);release();const again=acquirePayrollEmployeeLock('Synthetic Lock');again();
 for(const method of ['GET','POST'])assert.equal(requiredOpsPermission('/api/desktop/timecards',method).permission,'sensitive.write');assert.equal(opsRoleCan('operator','sensitive.write'),false);assert.equal(opsRoleCan('manager','sensitive.write'),true);
 console.log('PASS timecard deletion: exact-entry preview/cancel/stale/editor/expiry, audit before submit, uncertain no-replay, read-back, preserved history, no stale correction resurrection, writer lock and manager boundary. Synthetic only.');
}finally{if(previous===undefined)delete process.env.OPSBOT_DATA_DIR;else process.env.OPSBOT_DATA_DIR=previous;fs.rmSync(dir,{recursive:true,force:true});}}
main().catch(e=>{console.error(e);process.exitCode=1;});
