import assert from 'node:assert/strict';
import {scheduleTravelLayout, scheduleBlockMinimumWidth} from '../desktop-ui/lib/schedule-travel-layout';
import {scheduleOperationalStopLayout} from '../desktop-ui/lib/schedule-operational-stop-layout';
import {type ScheduleAppointment, type ScheduleRouteLeg, type ScheduleOperationalStop} from '../desktop-ui/lib/schedule-contract';
const jobs=[0,1,2,3].map(i=>({recordId:`job-${i}`,truck:'Truck 3',status:'Confirmed',address:'',hasScheduledTime:true,appointmentStartMinutes:480,appointmentEndMinutes:540} as ScheduleAppointment));
const legs=jobs.slice(1).map((to,i)=>({fromAppointmentId:jobs[i].recordId,toAppointmentId:to.recordId} as ScheduleRouteLeg));
const range={start:420,end:1020,duration:600};
const copy=JSON.stringify(jobs);
const overlap=scheduleTravelLayout(jobs,legs,range,'Truck 3',0,720,true,true);
assert.equal(overlap.laneCount,4,'Every genuinely overlapping window retains its own lane');
assert.equal(overlap.placed.length,4);
assert.equal(JSON.stringify(jobs),copy,'Packing never mutates appointment data');
assert.equal(scheduleBlockMinimumWidth(720),15/720,'Appointment minimum width represents fifteen minutes');
assert.equal(overlap.laneStep,48,'44px cards have separation');
assert.ok(overlap.connectors.every(c=>Math.abs(c.labelWidth*720-44)<.01));
const desktop=scheduleTravelLayout(jobs,legs,range,'Truck 3',0,720,true);
assert.deepEqual(desktop,scheduleTravelLayout(jobs,legs,range,'Truck 3',0,720,true,false),'Desktop defaults remain unchanged');
assert.ok(desktop.occupiedLanes.slice(desktop.laneCount).every(l=>l.every(i=>i.right-i.left<1)),'Desktop travel labels reserve only their footprint');
assert.ok(overlap.occupiedLanes.slice(overlap.laneCount).every(l=>l.every(i=>i.right-i.left<1)),'Mobile travel labels reserve their footprint instead of a whole row');
const stop={id:'warehouse',truck:'Truck 3',name:'HQ',kind:'hq',startMinutes:900,endMinutes:915} as ScheduleOperationalStop;
const stops=scheduleOperationalStopLayout([stop],range,720,overlap.occupiedLanes);
assert.ok(stops.placements[0].lane<overlap.occupiedLanes.length,'Facility stops reuse available space');

const noTravel=scheduleTravelLayout(jobs,[],range,'Truck 3',0,720,true,true);
assert.ok(overlap.rowHeight-noTravel.rowHeight<48*overlap.connectors.length,'Time labels use a compact gutter rather than another appointment-height lane');
for(const c of overlap.connectors) {
  const top=c.top+c.labelTop;
  assert.ok(top>=noTravel.rowHeight,'Travel labels stay below appointment cards');
  const atLabel={...stop,id:`stop-${c.leg.toAppointmentId}`,startMinutes:range.start+c.labelLeft*range.duration};
  const placement=scheduleOperationalStopLayout([atLabel],range,720,overlap.occupiedLanes).placements[0];
  const stopTop=placement.lane*overlap.laneStep+2;
  assert.ok(stopTop+22<=top || stopTop>=top+18,'A facility icon cannot overlap a compact travel label');
}
console.log('Mobile schedule layout PASS: real overlaps, immutable inputs, touch geometry, compact reservations and unchanged desktop defaults.');
