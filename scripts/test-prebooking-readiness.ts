import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {preparePrebookingReview} from '../lib/prebooking-readiness';
import {normalizeJunkwareAppointmentCreationInput} from '../lib/junkware-appointment-creation';
import {reviewBooking} from '../desktop-ui/lib/prebooking-review';
const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
const input=normalizeJunkwareAppointmentCreationInput({requestId:randomUUID(),franchise:'New Orleans',date,startTime:'09:00',durationHours:1,truck:'Truck 2',appointmentType:'Job',firstName:'Synthetic',lastName:'Customer',phone:'5045550100',billingAddress:'100 Example Road',billingZip:'70119',howHeard:'Referral',serviceAddress:'100 Example Road',serviceZip:'70119',estimatedPickups:1,scope:'Synthetic only'});
const snapshot={date,observedAt:null,appointments:[]};let calls=0;
const pending=preparePrebookingReview(input,snapshot,(day,stamp,hasRows,force,allowStart)=>{calls++;assert.equal(allowStart,true);assert.equal(day,date);assert.equal(stamp,null);assert.equal(hasRows,false);assert.equal(force,true);return {state:'loading',message:''};});assert.ok('pending' in pending);assert.equal(calls,1);
assert.ok('error' in preparePrebookingReview(input,snapshot,()=>({state:'failed',message:''})));
assert.ok('error' in preparePrebookingReview(input,snapshot,(_d,_s,_h,_f,allowStart)=>{assert.equal(allowStart,false);return {state:'failed',message:''};},Date.now(),true));
const ready=preparePrebookingReview(input,{...snapshot,observedAt:new Date().toISOString()},()=>{throw new Error('Fresh date must not collect');});assert.ok('check' in ready);
async function main(){
 let requests=0,waits=0;
 const result=await reviewBooking(input,{fetch:async(url,options)=>{requests++;assert.equal(url,'/api/desktop/schedule/creation/check');assert.equal(options?.body,JSON.stringify(input));assert.equal((options?.headers as Record<string,string>)['X-OpsCenter-Review-Poll'],requests===1?undefined:'1');return Response.json(requests<3?{pending:true,collectionStarted:true}:ready,{status:requests<3?202:200});},wait:async()=>{waits++;}});
 assert.deepEqual(result,'check' in ready?ready.check:null);assert.equal(waits,2);assert.equal(requests,3);
 await assert.rejects(reviewBooking(input,{fetch:async()=>Response.json({error:'Source unavailable'},{status:503})}),/Source unavailable/);
 await assert.rejects(reviewBooking(input,{fetch:async()=>new Response('<html>Unavailable</html>',{status:502})}),/Your details are saved/);
 let time=0;requests=0;
 await assert.rejects(reviewBooking(input,{now:()=>time,fetch:async()=>{requests++;return Response.json({pending:true},{status:202});},wait:async()=>{time+=70000;}}),/taking longer/);assert.equal(requests,3);
 console.log('Booking readiness passed: stale/empty date collection, fresh reuse, failure, bounded review-only polling, and unchanged draft payload.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
