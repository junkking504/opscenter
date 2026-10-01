import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scheduleOperationalStops } from '../lib/schedule-operational-stops';
import { applyRouteOrderConfirmations } from '../lib/schedule-route-order-confirmations';
import { scheduleStandaloneOperationalStops, timelineRange, timelineWindow, type ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';
import { operationalStopIcon, scheduleOperationalStopLayout, stopMinimumWidth } from '../desktop-ui/lib/schedule-operational-stop-layout';
import { scheduleRoutePairs, type DesktopAppointment } from '../lib/desktop-schedule';

const tracked = [
  {id:'dump-inside-return',kind:'geofence' as const,truck:'Truck 6',name:'BR Landfilll',facility:'Landfill',resetLocation:'dump' as const,enteredAt:'2026-09-30T18:19:47Z',departedAt:'2026-09-30T18:36:08Z',lastSeenAt:'2026-09-30T18:35:06Z'},
  {id:'dump-between-customers',kind:'geofence' as const,truck:'Truck 6',name:'BR Landfilll',facility:'Landfill',resetLocation:'dump' as const,enteredAt:'2026-09-30T20:12:37Z',departedAt:'2026-09-30T20:25:50Z',lastSeenAt:'2026-09-30T20:24:49Z'},
  {id:'hq-departure',kind:'geofence' as const,truck:'Truck 8',name:'Warehouse',facility:'Junk King warehouse',resetLocation:null,enteredAt:'2026-09-29T20:00:00Z',departedAt:'2026-09-30T13:27:40Z',lastSeenAt:'2026-09-30T13:26:39Z'},
  {id:'hq-visit',kind:'geofence' as const,truck:'Truck 6',name:'Warehouse',facility:'Junk King warehouse',resetLocation:null,enteredAt:'2026-10-01T02:15:23Z',departedAt:null,lastSeenAt:'2026-10-01T02:36:16Z'},
  {id:'brhq-visit',kind:'geofence' as const,truck:'Truck 7',name:'Warehouse',facility:'Junk King warehouse',resetLocation:null,enteredAt:'2026-09-30T13:15:23Z',departedAt:'2026-09-30T13:36:16Z',lastSeenAt:'2026-09-30T13:35:16Z',facilityPosition:{latitude:30.4191544,longitude:-91.144973}},
];
const stops=scheduleOperationalStops('2026-09-30',tracked);
assert.deepEqual(stops.filter(stop=>stop.truck==='Truck 6').map(stop=>[stop.kind,stop.label,Math.floor(stop.startMinutes),Math.floor(stop.endMinutes)]),[
  ['dump','Dump',799,816],['dump','Dump',912,925],['hq','NOHQ',1275,1296],
]);
assert.deepEqual(stops.find(stop=>stop.id==='hq-departure') && {kind:stops.find(stop=>stop.id==='hq-departure')!.kind,label:stops.find(stop=>stop.id==='hq-departure')!.label,start:Math.floor(stops.find(stop=>stop.id==='hq-departure')!.startMinutes)},
  {kind:'departure',label:'Left NOHQ',start:507},'An overnight HQ stay becomes a departure marker on the selected operating day');
assert.equal(stops.find(stop=>stop.id==='brhq-visit')?.label,'BRHQ','A generic Warehouse visit at the Baton Rouge warehouse coordinates is labeled BRHQ');

const terrencia={recordId:'2026-09-30:appointment:4090218',appointmentId:'4090218',jkNumber:'JK4103396',customerName:'Terrencia Polk',truck:'Truck 6',status:'Completed',hasScheduledTime:true,appointmentStartMinutes:660,appointmentEndMinutes:720,
  truckVisits:[{truck:'Truck 6',arrival:'2026-09-30T17:10:44Z',departure:'2026-09-30T18:00:24Z',observedThrough:'2026-09-30T18:00:24Z'},{truck:'Truck 6',arrival:'2026-09-30T18:53:30Z',departure:'2026-09-30T19:50:15Z',observedThrough:'2026-09-30T19:50:15Z'}],
  truckVisitGaps:[{truck:'Truck 6',departedAt:'2026-09-30T18:00:24Z',returnedAt:'2026-09-30T18:53:30Z',kind:'dump' as const,facilityName:'BR Landfilll'}]} as ScheduleAppointment;
assert.deepEqual(scheduleStandaloneOperationalStops(stops,[terrencia],'Truck 6').map(stop=>stop.id),['dump-between-customers','hq-visit'],'The dump already shown inside a return gap is not duplicated, while the later between-customer dump remains visible');
assert.equal(timelineRange([terrencia],Date.parse('2026-10-01T04:00:00Z'),stops).end,1320,'Late HQ stops extend the visible route range');

const crowdedStops = [
  {id:'left-nohq',truck:'Truck 6',name:'NOHQ',facility:'Junk King warehouse',kind:'departure' as const,label:'Left NOHQ',enteredAt:'2026-10-01T15:56:00Z',departedAt:'2026-10-01T15:56:00Z',observedThrough:'2026-10-01T15:56:00Z',startMinutes:656,endMinutes:656,ongoing:false},
  {id:'dump',truck:'Truck 6',name:'Gentilly',facility:'Landfill',kind:'dump' as const,label:'Dump',enteredAt:'2026-10-01T16:07:00Z',departedAt:'2026-10-01T16:28:00Z',observedThrough:'2026-10-01T16:28:00Z',startMinutes:667,endMinutes:688,ongoing:false},
  {id:'nohq',truck:'Truck 6',name:'NOHQ',facility:'Junk King warehouse',kind:'hq' as const,label:'NOHQ',enteredAt:'2026-10-01T16:38:00Z',departedAt:'2026-10-01T16:38:00Z',observedThrough:'2026-10-01T16:38:00Z',startMinutes:698,endMinutes:698,ongoing:false},
];
const emrStop = {id:'emr',truck:'Truck 8',name:'EMR',facility:'Metal recycling yard',kind:'facility' as const,label:'EMR',enteredAt:'2026-10-01T17:00:00Z',departedAt:'2026-10-01T17:10:00Z',observedThrough:'2026-10-01T17:10:00Z',startMinutes:720,endMinutes:730,ongoing:false};
assert.equal(operationalStopIcon(emrStop),'steel-beam','The canonical EMR facility uses the steel-beam pictogram');
assert.equal(stopMinimumWidth(emrStop),24,'The steel-beam stop remains as compact as the HQ and dump icons');
const crowdedLayout=scheduleOperationalStopLayout(crowdedStops,{start:480,duration:540},628);
assert.equal(crowdedLayout.laneCount,2,'Compact facility icons need fewer lanes while remaining separate');
assert.deepEqual(crowdedLayout.placements.map(row=>[row.stop.id,row.lane]),[['left-nohq',0],['dump',1],['nohq',0]]);

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'route-order-test-'));
process.env.SCHEDULE_ROUTE_ORDER_DIR=directory;
try {
  fs.writeFileSync(path.join(directory,'2026-09-30.json'),JSON.stringify({date:'2026-09-30',confirmations:[{truck:'Truck 6',appointmentId:'jesse',afterAppointmentId:'lyn',confirmedAt:'2026-10-01T15:30:00Z',confirmationSource:'mission_control_user_confirmation',note:'Jesse was after Lyn.'}]}));
  const job=(appointmentId:string,jkNumber:string,customerName:string,start:number,visit?:[string,string])=>({recordId:`2026-09-30:appointment:${appointmentId}`,appointmentId,jkNumber,customerName,truck:'Truck 6',status:'Completed',hasScheduledTime:true,appointmentStartMinutes:start,appointmentEndMinutes:start+60,truckVisits:visit?[{truck:'Truck 6',arrival:visit[0],departure:visit[1],observedThrough:visit[1]}]:[]} as DesktopAppointment);
  const cody=job('cody','JK4103354','Cody Daigle',600,['2026-09-30T15:05:55Z','2026-09-30T15:24:56Z']);
  const polk=job('polk','JK4103396','Terrencia Polk',660,['2026-09-30T17:10:44Z','2026-09-30T19:50:15Z']);
  const lyn=job('lyn','JK4096585','Lyn Bennett',480,['2026-09-30T21:01:28Z','2026-09-30T23:06:19Z']);
  const jesse=job('jesse','JK4104017','Jesse Hutcheson',960);
  const ordered=applyRouteOrderConfirmations('2026-09-30',[lyn,jesse,polk,cody]);
  const legs=scheduleRoutePairs(ordered);
  assert.deepEqual(legs.map(leg=>[leg.fromAppointmentId,leg.toAppointmentId]),[[cody.recordId,polk.recordId],[polk.recordId,lyn.recordId],[lyn.recordId,jesse.recordId]]);
  assert.equal(legs.at(-1)?.gapMinutes,null,'Confirmed sequence without a GPS arrival does not manufacture schedule buffer time');
  const corrected=ordered.find(job=>job.appointmentId==='jesse')! as ScheduleAppointment;
  const window=timelineWindow(corrected,'Truck 6',Date.parse('2026-10-01T04:00:00Z'))!;
  assert.equal(window.start,1086.3166666666666);
  assert.equal('sequence' in window && window.sequence,true);
  assert.match(window.label,/exact time unavailable/,'Route confirmation supplies order without manufacturing an arrival time');
} finally {
  fs.rmSync(directory,{recursive:true,force:true});
  delete process.env.SCHEDULE_ROUTE_ORDER_DIR;
}
console.log('Schedule operational stops passed: dump/HQ/EMR icons, overnight departures, gap deduplication, route range, and user-confirmed untimed ordering.');
