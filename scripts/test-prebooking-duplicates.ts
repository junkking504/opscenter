import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {prebookingCheck,requirePrebookingReview} from '../lib/prebooking-duplicates';
import {normalizeJunkwareAppointmentCreationInput} from '../lib/junkware-appointment-creation';
import {executeDesktopCreation} from '../lib/desktop-creation';
import type {ScheduleAppointment} from '../desktop-ui/lib/schedule-contract';
async function main(){
 const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
 const input=normalizeJunkwareAppointmentCreationInput({requestId:randomUUID(),franchise:'New Orleans',date,startTime:'09:00',durationHours:2,truck:'Truck 2',appointmentType:'Job',firstName:'Synthetic',lastName:'Customer',phone:'5045550100',billingAddress:'100 Example Road',billingZip:'70119',howHeard:'Referral',serviceAddress:'100 Example Rd',serviceZip:'70119',estimatedPickups:1,scope:'Synthetic only'});
 const job={recordId:date+':appointment:123',appointmentId:'123',jkNumber:'JK1000123',appointmentUrl:'https://junkware.junk-king.com/appointment.aspx?id=123',customerName:'Synthetic Customer',phone:'(504) 555-0100',address:'100 Example Road, New Orleans, LA 70119',hasScheduledTime:true,appointmentStartMinutes:600,appointmentEndMinutes:660,appointmentTime:'10:00–11:00 AM',appointmentType:'Estimate',status:'Confirmed',truck:'Truck 8',territory:'Jefferson Parish'} as ScheduleAppointment;
 const snapshot={date,observedAt:new Date().toISOString(),appointments:[job]};
 const check=prebookingCheck(input,snapshot);assert.equal(check.matches.length,1,'Overlap across category, franchise and truck warns');
 assert.throws(()=>requirePrebookingReview(input,check,null),/Review/);
 assert.throws(()=>requirePrebookingReview(input,check,{fingerprint:check.fingerprint,createSeparate:true}),/reason/);
 const intentional={...input,duplicateOverrideReason:'Second pickup requested by customer'};
 requirePrebookingReview(intentional,check,{fingerprint:check.fingerprint,createSeparate:true});
 assert.equal(prebookingCheck(intentional,snapshot).fingerprint,check.fingerprint);
 for(const change of [{status:'Canceled'},{address:'100 Example Road Apt 2, New Orleans, LA 70119'},{address:'100 Example Road, Baton Rouge, LA 70801'},{appointmentStartMinutes:660,appointmentEndMinutes:720},{customerName:'Different Person',phone:'5045550109'}])assert.equal(prebookingCheck(input,{...snapshot,appointments:[{...job,...change}]}).matches.length,0);
 assert.equal(prebookingCheck({...input,phone:'5045550109'},snapshot).matches.length,1,'Name also matches');
 assert.equal(prebookingCheck(input,{...snapshot,appointments:[{...job,status:'Completed'}]}).matches.length,1,'Prevent repeat service');
 for(const change of [{truck:'Truck 9'},{appointmentStartMinutes:590},{appointmentType:'Job'},{customerName:'Changed Name'},{address:'100 Example Road New Orleans LA 70119'},{territory:'Baton Rouge'}])assert.notEqual(prebookingCheck(input,{...snapshot,appointments:[{...job,...change}]}).fingerprint,check.fingerprint);
 assert.equal(prebookingCheck(input,{...snapshot,observedAt:new Date(Date.now()+1000).toISOString()}).fingerprint,check.fingerprint,'Collection timestamp is not a booking edit');
 assert.throws(()=>prebookingCheck(input,{...snapshot,observedAt:null}),/fresh/);
 assert.throws(()=>prebookingCheck(input,{...snapshot,observedAt:new Date(Date.now()-301000).toISOString()}),/fresh/);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'prebooking-test-'));process.env.OPSCENTER_DESKTOP_CREATIONS_DIR=dir;
 let calls=0;
 const create=async()=>{calls++;return {replayed:false,result:{appointmentId:'999',jkNumber:'JK1000999',appointmentUrl:'https://example.invalid/999',franchise:input.franchise,date,startTime:input.startTime,durationHours:input.durationHours,truck:input.truck,appointmentType:input.appointmentType,customerMode:'new' as const,verifiedAt:new Date().toISOString()}};};
 try {
   await assert.rejects(executeDesktopCreation(input,'synthetic',create,value=>requirePrebookingReview(value,check,null)),/Review/);assert.equal(calls,0);
   const result=await executeDesktopCreation(intentional,'synthetic',create,value=>requirePrebookingReview(value,check,{fingerprint:check.fingerprint,createSeparate:true}));assert.equal(result.status,'verified');assert.equal(calls,1);
   await executeDesktopCreation(intentional,'synthetic',create,()=>{throw Error('A replay must not recheck or write');});assert.equal(calls,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
 console.log('Prebooking duplicates passed: overlapping windows, category/franchise independence, address/ZIP/unit safety, stale-source and changed-review gates, explicit reason, no writes when blocked, safe replay. Synthetic only.');
}
void main();
