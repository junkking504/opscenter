import assert from 'node:assert/strict';
import { scheduleOperationalStopLayout } from '../desktop-ui/lib/schedule-operational-stop-layout';
import { scheduleTravelLayout } from '../desktop-ui/lib/schedule-travel-layout';
import { timelineRange, type ScheduleAppointment, type ScheduleRouteLeg, type ScheduleOperationalStop } from '../desktop-ui/lib/schedule-contract';
const job = (id: string, start: number, end: number) => ({ recordId: id, appointmentStartMinutes: start, appointmentEndMinutes: end, hasScheduledTime: true } as ScheduleAppointment);
const leg = (from: string, to: string, gap: number) => ({ fromAppointmentId: from, toAppointmentId: to, gapMinutes: gap, travelMinutes: 14, miles: 6.3 } as ScheduleRouteLeg);
const jobs = [job('a',480,540),job('b',540,600),job('c',600,660),job('d',600,660),job('e',600,660)];
const range = timelineRange(jobs);
const layout = scheduleTravelLayout(jobs,[leg('a','b',0),leg('b','c',0),leg('c','d',-60),leg('d','e',-60)],range);
assert.equal(layout.connectors.length,4,'Adjacent and overlapping legs must all appear');
assert.deepEqual(layout.connectors.map(c=>c.vertical),[false,false,true,true]);
assert.ok(layout.placed.every(p=>p.position.left===(p.job.appointmentStartMinutes!-range.start)/range.duration),'Preserve booked horizontal position');
assert.equal(scheduleTravelLayout(jobs,[leg('unknown','c',0)],range).connectors.length,0);
const tiedJobs=['a','b','c','d'].map(id=>job(id,480,540));
const tiedLegs=[leg('a','b',-60),leg('b','c',-60),leg('c','d',-60)];
for (const mobile of [false,true]) for (const width of [190,320,720,1280]) {
  const input=[job('first',960,1020),job('second',960,1020),job('next',1020,1080)];
  const drawn=scheduleTravelLayout(input,[leg('second','first',-60),leg('first','next',0)],timelineRange(input),undefined,0,width,false,mobile);
  assert.deepEqual(drawn.placed.map(p=>p.lane),[0,1,0],'Touching windows reuse the top lane, overlapping windows stack');
  assert.deepEqual(drawn.connectors.map(c=>[c.from.job.recordId,c.to.job.recordId]),[['second','first'],['first','next']],'Named travel items follow route order, including reverse/overlapping windows');
}

// The displayed start can differ from the booked window once GPS evidence is
// available. A saved Stop Order still owns the vertical order when those two
// rendered blocks overlap.
const actualFirst={...job('2026-09-29:appointment:actual-first',480,540),truck:'Truck 3',stopOrder:0,onsiteTime:{minutes:20,arrival:'2026-09-29T13:20:00.000Z',departure:'2026-09-29T13:40:00.000Z'}} as ScheduleAppointment;
const plannedSecond={...job('2026-09-29:appointment:planned-second',480,540),truck:'Truck 3',stopOrder:1} as ScheduleAppointment;
const orderedStack=scheduleTravelLayout([plannedSecond,actualFirst],[],timelineRange([plannedSecond,actualFirst]),'Truck 3',Date.parse('2026-09-29T14:00:00.000Z'));
assert.deepEqual(orderedStack.placed.map(item=>[item.job.recordId,item.lane]),[[actualFirst.recordId,0],[plannedSecond.recordId,1]],'Saved Stop Order must dictate top and bottom even when GPS changes the displayed start');

const unsavedStack=scheduleTravelLayout([{...actualFirst,stopOrder:undefined},{...plannedSecond,stopOrder:undefined}],[],timelineRange([plannedSecond,actualFirst]),'Truck 3',Date.parse('2026-09-29T14:00:00.000Z'));
assert.deepEqual(unsavedStack.placed.map(item=>item.job.recordId),[actualFirst.recordId,plannedSecond.recordId],'Without a saved order, recorded visits reserve the top lane before planned windows');
console.log('Saved Stop Order controls the visual top-to-bottom stack across planned and GPS-rendered blocks.');

// Finished work remains above the next booked stops even when GPS includes
// seconds after their shared booked start. This must survive input reordering.
const finished={...job('2026-10-03:appointment:finished',480,540),truck:'Truck 4',status:'Completed',truckVisits:[{truck:'Truck 4',arrival:'2026-10-03T15:00:20Z',departure:'2026-10-03T15:35:00Z',observedThrough:'2026-10-03T15:35:00Z'}]} as ScheduleAppointment;
const nextStops=[{...job('next',600,660),truck:'Truck 4',stopOrder:0},{...job('later',600,660),truck:'Truck 4',stopOrder:1}];
for (const mobile of [false,true]) for (const input of [[...nextStops,finished],[finished,...nextStops].reverse()]) {
  const before=JSON.stringify(input);
  const drawn=scheduleTravelLayout(input,[],timelineRange(input),'Truck 4',Date.parse('2026-10-03T15:48:00Z'),mobile?190:720,!mobile,mobile);
  assert.deepEqual(drawn.placed.map(p=>[p.job.recordId,p.lane]),[[finished.recordId,0],['next',1],['later',2]]);
  assert.equal(drawn.placed[0].position.start,600+20/60,'Recorded arrival retains its exact horizontal position');
  assert.equal(JSON.stringify(input),before,'Stacking never changes bookings, assignment or saved stop order');
}
const explicitReverse=scheduleTravelLayout([{...actualFirst,stopOrder:1},{...plannedSecond,stopOrder:0}],[],timelineRange([actualFirst,plannedSecond]),'Truck 3',Date.parse('2026-09-29T14:00:00Z'));
assert.equal(explicitReverse.placed[0].job.recordId,plannedSecond.recordId,'Explicit saved same-window order remains authoritative within its group');
const closedEstimate={...finished,recordId:'2026-10-03:appointment:closed-estimate',truck:'Truck 8',status:'Estimate Closed',appointmentStartMinutes:540,appointmentEndMinutes:600,truckVisits:[{truck:'Truck 8',arrival:'2026-10-03T15:18:00Z',departure:'2026-10-03T15:32:00Z',observedThrough:'2026-10-03T15:32:00Z'}]} as ScheduleAppointment;
const followingJob={...job('following-job',600,660),truck:'Truck 8'};
for (const mobile of [false,true]) {
  const input=[followingJob,closedEstimate];
  const drawn=scheduleTravelLayout(input,[],timelineRange(input),'Truck 8',Date.parse('2026-10-03T15:50:00Z'),mobile?190:720,!mobile,mobile);
  assert.deepEqual(drawn.placed.map(p=>[p.job.recordId,p.lane]),[[closedEstimate.recordId,0],[followingJob.recordId,1]],'Upcoming job stays underneath the completed estimate');
}

// Fifteen-minute minimum widths follow the ruler at every viewport size.
const mobileVisits=[0,1,2].map(index=>({...job(`2026-09-29:appointment:mobile-${index}`,480+index*60,500+index*60),truck:'Truck 8',status:'Completed',onsiteTime:{minutes:20,arrival:`2026-09-29T${String(13+index).padStart(2,'0')}:00:00.000Z`,departure:`2026-09-29T${String(13+index).padStart(2,'0')}:20:00.000Z`}} as ScheduleAppointment));
const mobileRange=timelineRange(mobileVisits);
const desktopFootprint=scheduleTravelLayout(mobileVisits,[],mobileRange,'Truck 8',Date.parse('2026-09-29T17:00:00.000Z'),1000);
assert.equal(new Set(desktopFootprint.placed.map(item=>item.lane)).size,1,'Wide timelines keep sequential short visits in one lane');
const phoneFootprint=scheduleTravelLayout(mobileVisits,[],mobileRange,'Truck 8',Date.parse('2026-09-29T17:00:00.000Z'),190);
assert.equal(new Set(phoneFootprint.placed.map(item=>item.lane)).size,1,'Sequential visits fit when their minimum is fifteen timeline minutes');
assert.equal(phoneFootprint.rowHeight,desktopFootprint.rowHeight,'Viewport width does not inflate time-based appointment footprints');
const shortVisits=[job('short-a',480,481),job('short-b',490,491)];
const shortLayout=scheduleTravelLayout(shortVisits,[],{start:420,end:1020,duration:600},undefined,0,720);
assert.equal(shortLayout.laneCount,2,'Fifteen-minute minimum footprints cannot overlap on one lane');
console.log('Mobile layout packs minimum-width appointment cards into non-overlapping lanes.');

// A confirmed off-site gap remains visible between return visits. An
// intervening appointment must not collide with that striped gap.
const returning = {...job('returning',480,720),truck:'Truck 8',onsiteTime:{minutes:40,arrival:'2026-09-29T13:00:00Z',departure:'2026-09-29T16:20:00Z',intervals:[{arrival:'2026-09-29T13:00:00Z',departure:'2026-09-29T13:20:00Z'},{arrival:'2026-09-29T16:00:00Z',departure:'2026-09-29T16:20:00Z'}]}} as ScheduleAppointment;
const between={...job('between',540,600),truck:'Truck 8'};
const consolidated=scheduleTravelLayout([returning,between],[],timelineRange([returning,between]),'Truck 8',Date.parse('2026-09-29T18:00:00Z'),1000);
assert.equal(consolidated.laneCount,2,'An intervening appointment uses a separate lane from the visible off-site gap');
assert.equal(consolidated.occupiedLanes[0].length,3,'Facility packing receives two visit segments and their visible gap');
assert.notEqual(consolidated.placed.find(p=>p.job.recordId==='between')!.lane, consolidated.placed.find(p=>p.job.recordId==='returning')!.gapLanes[0]);
console.log('Return visits preserve their striped off-site gap without covering intervening appointments.');

const withoutTravel=scheduleTravelLayout(jobs,[],range);
assert.ok(layout.rowHeight>withoutTravel.rowHeight,'Truck rows include room for readable travel labels');
assert.deepEqual(layout.placed,withoutTravel.placed,'Loading travel times does not move appointments or their lane assignments');
assert.equal(layout.laneStep,withoutTravel.laneStep,'Travel times do not change lane spacing');
assert.deepEqual(layout.occupiedLanes.slice(0,layout.laneCount),withoutTravel.occupiedLanes,'Travel labels preserve appointment reservations');

// Labels can share a row only when their full rendered footprints do not
// intersect. This also covers duplicate/self legs from fragmented GPS visits.
for (const mobile of [false,true]) for (const width of [190,320,720,1280]) {
  const routes=[...tiedLegs,leg('d','a',-60),leg('a','a',-60),leg('a','a',-60)];
  const drawn=scheduleTravelLayout(tiedJobs,routes,range,undefined,0,width,true,mobile);
  const bare=scheduleTravelLayout(tiedJobs,[],range,undefined,0,width,true,mobile);
  assert.deepEqual(drawn.placed,bare.placed,'Label packing preserves appointment geometry');
  const boxes=drawn.connectors.map(c=>({left:c.labelLeft,right:c.labelLeft+c.labelWidth,top:c.top+c.labelTop,bottom:c.top+c.labelTop+38}));
  boxes.forEach((box,index)=>{
    assert.ok(box.left>=0 && box.right<=1 && box.top>=bare.rowHeight && box.bottom<=drawn.rowHeight,'Labels are inside the truck row and below all appointments');
    assert.ok((box.right-box.left)*width >= Math.min(184,width-6),'Named travel items retain room for endpoint names');
    for(const other of boxes.slice(index+1)) assert.ok(box.right<=other.left || box.left>=other.right || box.bottom<=other.top || box.top>=other.bottom,'Every travel label has its own non-overlapping hit area');
    const stop={id:`label-${index}`,truck:'Truck 3',name:'HQ',kind:'hq',startMinutes:range.start+box.left*range.duration,endMinutes:range.start+box.left*range.duration+1} as ScheduleOperationalStop;
    const packed=scheduleOperationalStopLayout([stop],range,width,drawn.occupiedLanes).placements[0];
    const top=packed.lane*drawn.laneStep+2;
    assert.ok(top+22<=box.top || top>=box.bottom,'Facility icons cannot occupy a travel label');
  });
}
const separated=scheduleTravelLayout([job('one',480,510),job('two',570,600),job('three',660,690)],[leg('one','two',60),leg('two','three',60)],range,undefined,0,1280);
assert.equal(separated.connectors[0].top+separated.connectors[0].labelTop,separated.connectors[1].top+separated.connectors[1].labelTop,'Non-overlapping labels reuse a compact row');
console.log('Travel labels remain readable, bounded, collision-free and reserved against facility icons at phone and desktop widths.');
