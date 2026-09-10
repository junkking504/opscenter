import assert from 'node:assert/strict';
import { nextTruckStop } from '../lib/schedule-next-stop';
import { calculateTruckProgress } from '../lib/desktop-truck-progress';
import type { DesktopAppointment } from '../lib/desktop-schedule';
import type { ScheduleTruck } from '../desktop-ui/lib/schedule-contract';
async function main() {
const now=Date.parse('2026-09-10T16:00:00Z');
const job=(id:string,more:Partial<DesktopAppointment>={})=>({recordId:id,version:'v1',truck:'Truck 9',status:'Confirmed',appointmentType:'Job',appointmentStartMinutes:660,appointmentEndMinutes:720,location:{latitude:30,longitude:-90},...more} as DesktopAppointment);
const gps={truck:'Truck 9',latitude:30.2,longitude:-90.2,lastGpsUpdate:new Date(now-20000).toISOString()} as ScheduleTruck;
const done=job('done',{status:'Completed',appointmentStartMinutes:540,appointmentEndMinutes:600,onsiteTime:{arrival:new Date(now-3600000).toISOString(),departure:new Date(now-600000).toISOString(),minutes:50,label:'50 min'}});
const first=job('z-first',{stopOrder:0}),second=job('a-second',{stopOrder:1});
const jobs=[second,done,first,job('unassigned',{truck:'Virtual Truck'})];
assert.equal(nextTruckStop(jobs,'Truck 9',true,now)?.job.recordId,'z-first');
assert.equal(nextTruckStop(jobs,'Truck 9',true,now)?.between,true);
assert.equal(nextTruckStop(jobs,'Unassigned',true,now),null);
assert.equal(nextTruckStop(jobs,'Truck 9',false,now),null);
let calls=0;
const provider=async()=>{calls++;return [{originIndex:0,destinationIndex:0,condition:'ROUTE_EXISTS',duration:'720s',distanceMeters:8000}];};
const get=(j=jobs,t=[gps],live=true,p:Parameters<typeof calculateTruckProgress>[3]=provider)=>calculateTruckProgress(j,t,live,p,now);
let result=await get();
assert.equal(calls,1);assert.equal(result.length,1);assert.equal(result[0].appointmentId,'z-first');assert.equal(result[0].minutes,12);assert.equal(result[0].arrivalAt,'2026-09-10T16:12:00.000Z');
result=await get(jobs,[{...gps,lastGpsUpdate:new Date(now-181000).toISOString()}]);assert.equal(result[0].status,'stale_gps');assert.equal(calls,1);
await get(jobs,[{...gps,lastGpsUpdate:new Date(now+1000).toISOString()}]);assert.equal(calls,1,'Future GPS cannot generate an ETA');
assert.deepEqual(await get(jobs,[gps],false),[]);
assert.equal((await get([job('pending',{junkwareSyncStatus:'pending',stopOrder:0}),second]))[0].status,'unverified');assert.equal(calls,1,'Do not skip the unverified first stop');
assert.equal((await get([job('onsite',{truckOnSite:true,onsiteTruck:'Truck 9'}),second]))[0].status,'on_site');assert.equal(calls,1);
assert.equal((await get([job('seen',{lastSeenOnsiteTruck:'Truck 9'}),second]))[0].status,'last_seen');assert.equal(calls,1);
assert.equal((await get([job('missing',{location:null})]))[0].status,'address_unverified');assert.equal(calls,1);
assert.equal(nextTruckStop([job('departed',{onsiteTime:done.onsiteTime}),second],'Truck 9',true,now)?.job.recordId,'a-second','Confirmed departure advances next stop without rewriting job status');
assert.equal((await get(jobs,[gps],true,async()=>{throw Error('unavailable');}))[0].status,'routing_unavailable');
assert.equal((await get(jobs,[gps],true,async()=>[{condition:'ROUTE_EXISTS',duration:'NaNs',distanceMeters:NaN}]))[0].minutes,null);
assert.equal((await get(jobs,[gps],true,async()=>[{condition:'ROUTE_EXISTS',duration:'300s',distanceMeters:3000}]))[0].minutes,5,'Fresh position can produce a shorter remaining ETA');
console.log('Truck progress PASS: saved order, departure, on site, stale/future GPS, no assignment changes, isolated truck routing, failed/malformed routes and refreshed ETA.');

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
