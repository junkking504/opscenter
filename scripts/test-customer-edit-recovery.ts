import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import type {DesktopAppointment} from '../lib/desktop-schedule';
import type {CustomerSource} from '../lib/customer-edit';
async function main(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'customer-recovery-'));
 process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR=path.join(dir,'receipts');process.env.JOB_ROUTE_ASSIGNMENTS_FILE=path.join(dir,'assignments.json');process.env.OPSCENTER_DATA_DIR=path.join(dir,'data');
 const {executeScheduleOperation,parseScheduleOperation,reconcileCustomerReceipt,resolveCustomerManualReview}=await import('../lib/desktop-schedule-operations');
 const {recordCustomerEdit,applyCustomerEdits}=await import('../lib/customer-edit');
 const customer={firstName:'Test',lastName:'Customer',phone:'5045550100',secondaryPhone:'',email:'',address:'100 Example St',zip:'70112'};
 const values={customer,expectedSourceVersion:'a'.repeat(64),protectedVersion:'b'.repeat(64)};
 const job=(id:string)=>({appointmentId:id,recordId:`2026-10-21:appointment:${id}`,version:'c'.repeat(64),status:'Confirmed',customerName:'Original Customer',phone:'5045550000',customerEmail:'old@example.com',address:'100 Example St, New Orleans, LA 70112'} as DesktopAppointment);
 const operation=(id:string,requestId=crypto.randomUUID())=>parseScheduleOperation({requestId,date:'2026-10-21',recordId:job(id).recordId,expectedVersion:job(id).version,action:'customer',values});
 try{
  let writes=0;
  for(const [index,kind] of ['verified','unchanged','different'].entries()){
   const id=String(500+index),op=operation(id);const run=async()=>{writes++;return {status:202,body:{ok:false,expected:values}};};
   assert.equal((await executeScheduleOperation(op,'test-actor',()=>job(id),run)).status,'uncertain');
   await executeScheduleOperation(op,'test-actor',()=>job(id),run);assert.equal(writes,index+1);
   await assert.rejects(()=>executeScheduleOperation(operation(id),'test-actor',()=>job(id),run));
   let reads=0;await reconcileCustomerReceipt(op.requestId,'other-actor',async()=>{reads++;throw Error();});assert.equal(reads,0);
   const source:CustomerSource={ok:true,customer:kind==='verified'?customer:{...customer,firstName:'Original'},sourceVersion:kind==='unchanged'?values.expectedSourceVersion:'d'.repeat(64),protectedVersion:values.protectedVersion,displayAddress:'100 Example St, New Orleans, LA 70112',checkedAt:new Date().toISOString()};
   const result=await reconcileCustomerReceipt(op.requestId,'test-actor',async()=>source);
   assert.equal(result?.status,kind==='verified'?'verified':kind==='unchanged'?'failed':'uncertain');
   if(kind==='different'){
    await assert.rejects(()=>resolveCustomerManualReview({requestId:op.requestId,recordId:op.recordId,date:op.date},'other-actor'));
    assert.equal((await resolveCustomerManualReview({requestId:op.requestId,recordId:op.recordId,date:op.date},'test-actor')).status,'reconciled');
   }
  }
  const delayed=operation('700');
  assert.equal((await resolveCustomerManualReview({requestId:delayed.requestId,recordId:delayed.recordId,date:delayed.date},'test-actor')).status,'reconciled');
  await assert.rejects(()=>executeScheduleOperation(delayed,'test-actor',()=>job('700'),async()=>{writes++;return {status:200,body:{ok:true}};}),/different change/);
  assert.equal(writes,3,'Manual review never resubmits and tombstones delayed writes.');
  const verified:CustomerSource={ok:true,customer:{...customer,firstName:'Updated'},previousCustomer:customer,protectedVersion:'b'.repeat(64),sourceVersion:'d'.repeat(64),checkedAt:new Date().toISOString(),verifiedAt:new Date().toISOString(),displayAddress:'100 Example St, New Orleans, LA 70112'};
  recordCustomerEdit('800',verified);const original=job('800');
  assert.equal(applyCustomerEdits([original],0)[0].address,original.address,'Contact-only edits preserve exact map/address cache key.');
  assert.equal(applyCustomerEdits([original],Date.now()+10000)[0].customerName,original.customerName,'New collected source takes precedence.');
  recordCustomerEdit('800',{...verified,customer:{...verified.customer,address:'200 Example St'},displayAddress:'200 Example St, New Orleans, LA 70112'});
  assert.equal(applyCustomerEdits([original],0)[0].address,'200 Example St, New Orleans, LA 70112');
  console.log('Customer recovery and display passed: idempotency, pending guard, actor guard, read-only outcomes, manual-review tombstone, exact unchanged address and collector precedence. Isolated state only.');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}
void main();
