import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {DesktopAppointment} from '../lib/desktop-schedule';

async function main() {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'gps-assignment-'));
 process.env.OPSCENTER_DATA_DIR=directory;
 process.env.OPSBOT_DATA_DIR=directory;
 process.env.JOB_ROUTE_ASSIGNMENTS_FILE=path.join(directory,'assignments.json');
 process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR=path.join(directory,'receipts');
 const {visitedAssignmentTruck,reconcileVisitedAssignments}=await import('../lib/gps-visit-assignment');
 const {readJobRouteAssignmentOverrides}=await import('../lib/job-route-assignments');
 const {scheduleDisplayTruck}=await import('../desktop-ui/lib/schedule-contract');
 const now=Date.parse('2026-09-28T17:00:00Z'),date='2026-09-28',arrival='2026-09-28T15:23:42Z';
 const job=(id:string)=>({appointmentId:id,recordId:`${date}:appointment:${id}`,version:'a'.repeat(64),truck:'Unassigned',status:'Confirmed',
  location:{latitude:30,longitude:-90},appointmentStartMinutes:900,appointmentEndMinutes:960,
  truckVisits:[{truck:'Truck 3',arrival,departure:null,observedThrough:arrival}]} as DesktopAppointment);
 const base=job('1234');
 assert.equal(visitedAssignmentTruck(base,date,now),'Truck 3','A single early GPS point is sufficient');
 assert.equal(scheduleDisplayTruck(base),'Truck 3','Board leaves the unassigned lane immediately on unique GPS evidence');
 for(const changed of [
  {...base,truck:'Truck 8'}, {...base,status:'Canceled'}, {...base,location:null},
  {...base,junkwareSyncStatus:'pending'}, {...base,appointmentId:''},
  {...base,truckVisits:[...base.truckVisits!,{...base.truckVisits![0],truck:'Truck 4'}]},
  {...base,truckVisits:[{...base.truckVisits![0],arrival:'2026-09-27T15:23:42Z'}]},
  {...base,truckVisits:[{...base.truckVisits![0],arrival:'2026-09-28T19:00:00Z'}]},
 ] as DesktopAppointment[]) assert.equal(visitedAssignmentTruck(changed,date,now),null);
 assert.equal(visitedAssignmentTruck({...base,status:'Completed'},date,now),'Truck 3');
 let calls=0;
 const sync=async(input:Parameters<NonNullable<Parameters<typeof reconcileVisitedAssignments>[1]>['sync'] & {}>[0])=>{
  calls++;
  assert.deepEqual(input,{appointmentId:'1234',truck:'Truck 3',expectedDate:date,onlyIfUnassigned:true});
  return {appointmentId:'1234',previousTruck:'',truck:'Truck 3',changed:true,date,appointmentStartMinutes:900,appointmentEndMinutes:960,verifiedAt:new Date(now).toISOString()};
 };
 try {
  const results=await Promise.all([reconcileVisitedAssignments(date,{load:()=>[base],sync,now}),reconcileVisitedAssignments(date,{load:()=>[base],sync,now})]);
  assert.equal(calls,1,'Concurrent refreshes submit once');
  assert.ok(results.flat().some(r=>r.status==='verified'));
  const saved=readJobRouteAssignmentOverrides(date).get('appt:1234')!;
  assert.equal(saved.truck,'Truck 3');assert.equal(saved.junkwareSyncStatus,'verified');assert.equal(saved.appointmentStartMinutes,900);
  await reconcileVisitedAssignments(date,{load:()=>[base],sync,now});
  assert.equal(calls,1,'Restart and later manual unassignment cannot replay the visit');
  const unknown=job('5678');let uncertain=0;
  const fail=async()=>{uncertain++;throw new Error('response lost');};
  const failed=await reconcileVisitedAssignments(date,{load:()=>[unknown],sync:fail,now});
  assert.equal(failed[0].status,'uncertain');
  await reconcileVisitedAssignments(date,{load:()=>[unknown],sync:fail,now});
  assert.equal(uncertain,1,'Unknown source result is never retried automatically');
  assert.equal(readJobRouteAssignmentOverrides(date).has('appt:5678'),false,'No verified label after uncertain source write');
  const reassigned=await reconcileVisitedAssignments(date,{load:()=>[job('6789')],sync:async()=>{throw new Error('The appointment already has a saved truck. No automatic move was submitted.');},now});
  assert.equal(reassigned[0].status,'failed','A known preflight rejection must not leave a pending source write');
  assert.equal(readJobRouteAssignmentOverrides(date).has('appt:6789'),false,'A dispatcher assignment is never overwritten');
  assert.deepEqual(await reconcileVisitedAssignments('2026-09-27',{load:()=>{throw new Error('must not read historical day');},sync,now}),[]);
  console.log('GPS assignment passed: immediate physical lane, single-point/early visits, source-only truck change, preserved booking, identity/date/conflict guards, concurrency, restart and uncertain-write protection. Synthetic source only.');
 } finally {fs.rmSync(directory,{recursive:true,force:true});}
}
void main();
