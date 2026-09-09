import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stopGroups, stopGroupKey, stopOrderSourceKey, isStopPermutation } from '../lib/schedule-stop-order';
import { applyStopOrders, saveStopOrder, StopOrderConflict } from '../lib/desktop-stop-order-store';
import { calculateDesktopRouteLegs, type DesktopAppointment } from '../lib/desktop-schedule';
import { nearestStopOrder } from '../lib/desktop-stop-order';
import { scheduleTravelLayout } from '../desktop-ui/lib/schedule-travel-layout';
import { timelineRange, type ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';

async function main() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'stop-order-test-'));
  process.env.SCHEDULE_STOP_ORDER_DIR=directory;
  try {
    const jobs=[1,2,3,4].map(id=>({recordId:`2026-09-09:appointment:${id}`,appointmentId:String(id),version:'1',address:'100 Example St New Orleans LA 70125',status:'Confirmed',truck:'Truck 8',appointmentStartMinutes:480,appointmentEndMinutes:540,hasScheduledTime:true,location:{latitude:30,longitude:-90+id/100},jkNumber:`JK${id}`} as DesktopAppointment));
    const read=()=>applyStopOrders('2026-09-09',jobs);
    const group=stopGroups(read())[0], ids=group.map(job=>job.recordId);
    const input={date:'2026-09-09',groupKey:stopGroupKey(group[0]),sourceKey:stopOrderSourceKey(group),ids:[ids[0],ids[3],ids[1],ids[2]],actor:'test'};
    assert(!isStopPermutation(group,[ids[0],ids[0],ids[2],ids[3]]));
    assert(!isStopPermutation(group,[...ids.slice(0,3),'foreign']));
    assert.throws(()=>saveStopOrder({...input,ids:ids.slice(1)},read));
    saveStopOrder(input,read);
    const ordered=read();
    assert.deepEqual(stopGroups(ordered)[0].map(job=>job.recordId),input.ids,'Saved order must survive an independent read');
    assert.deepEqual(ordered.map(({stopOrder,...job})=>job),jobs,'No truck, time, status or source version changes');
    assert.throws(()=>saveStopOrder(input,read),StopOrderConflict,'Stale writers cannot overwrite saved order');
    const legs=await calculateDesktopRouteLegs(ordered,async()=>[{originIndex:0,destinationIndex:0,duration:'600s',distanceMeters:3000,condition:'ROUTE_EXISTS'}]);
    assert.deepEqual(legs.map(leg=>[leg.fromAppointmentId,leg.toAppointmentId]),[[ids[0],ids[3]],[ids[3],ids[1]],[ids[1],ids[2]]]);
    const layout=scheduleTravelLayout(ordered as ScheduleAppointment[],legs,timelineRange(ordered as ScheduleAppointment[]));
    assert.deepEqual(layout.placed.map(row=>row.job.recordId),input.ids);
    assert.equal(new Set(layout.connectors.map(c=>c.top+c.labelTop)).size,3,'Every ETA remains separately clickable');
    assert.equal(stopGroups(read().map(job=>({...job,truck:'Unassigned'}))).length,0);
    assert.equal(stopGroups(read().map(job=>({...job,status:'Canceled'}))).length,0);
    assert.equal(applyStopOrders('2026-09-10',jobs)[0].stopOrder,undefined,'Order cannot leak into another day');
    assert.equal(applyStopOrders('2026-09-09',jobs.map(job=>({...job,appointmentEndMinutes:600})))[0].stopOrder,undefined,'Order cannot leak into another window');
    const nearer=await nearestStopOrder(jobs,async(_,destinations)=>destinations.map((point,index)=>({originIndex:0,destinationIndex:index,distanceMeters:1000*(1-point.longitude/100),duration:'600s',condition:'ROUTE_EXISTS'})));
    assert.equal(nearer[0].recordId,ids[0],'Keep the chosen first stop');
    assert.equal(nearer[1].recordId,ids[3],'Use road distance rather than input or straight-line order');
    await assert.rejects(()=>nearestStopOrder(jobs,async()=>null));
    await assert.rejects(()=>nearestStopOrder(jobs.map(job=>({...job,location:null}))));
    console.log('Stop order passed: persistence, source conflicts, permutation safety, unchanged bookings, day/window isolation, matching ETA layout, road-nearest suggestion and unavailable inputs.');
  } finally {fs.rmSync(directory,{recursive:true,force:true});delete process.env.SCHEDULE_STOP_ORDER_DIR;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
