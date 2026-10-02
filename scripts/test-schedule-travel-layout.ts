import assert from 'node:assert/strict';
import { scheduleTravelLayout } from '../desktop-ui/lib/schedule-travel-layout';
import { timelineRange, type ScheduleAppointment, type ScheduleRouteLeg } from '../desktop-ui/lib/schedule-contract';
const job = (id: string, start: number, end: number) => ({ recordId: id, appointmentStartMinutes: start, appointmentEndMinutes: end, hasScheduledTime: true } as ScheduleAppointment);
const leg = (from: string, to: string, gap: number) => ({ fromAppointmentId: from, toAppointmentId: to, gapMinutes: gap, travelMinutes: 14, miles: 6.3 } as ScheduleRouteLeg);
const jobs = [job('a',480,540),job('b',540,600),job('c',600,660),job('d',600,660),job('e',600,660)];
const range = timelineRange(jobs);
const layout = scheduleTravelLayout(jobs,[leg('a','b',0),leg('b','c',0),leg('c','d',-60),leg('d','e',-60)],range);
assert.equal(layout.connectors.length,4,'Adjacent and overlapping legs must all appear');
assert.deepEqual(layout.connectors.map(c=>c.vertical),[false,false,true,true]);
assert.ok(layout.connectors.every(c=>c.width>0 && c.top>=0 && c.top+c.height<=layout.rowHeight));
assert.ok(layout.placed.every(p=>p.position.left===(p.job.appointmentStartMinutes!-range.start)/range.duration),'Preserve booked horizontal position');
const reverse = scheduleTravelLayout(jobs,[leg('e','c',-60)],range).connectors[0];
assert.equal(reverse.reverse,true,'Arrow follows route order even if stack order differs');
assert.ok(reverse.top+reverse.labelTop>=0 && reverse.top+reverse.labelTop+12<=scheduleTravelLayout(jobs,[leg('e','c',-60)],range).rowHeight, 'Travel times fit inside the existing lane gutter');
const gap = scheduleTravelLayout([jobs[0],jobs[2]],[leg('a','c',60)],range).connectors[0];
assert.equal(gap.width,60/range.duration,'Separated windows keep the actual gap bounds');
assert.equal(scheduleTravelLayout(jobs,[leg('unknown','c',0)],range).connectors.length,0);
console.log('Travel layout passed: shared/adjacent/gapped windows, direction, bounds and preserved appointment placement.');
// Source row order can differ from the stable same-window route proposal.
const tiedJobs=['a','b','c','d'].map(id=>job(id,480,540));
const tiedLegs=[leg('a','b',-60),leg('b','c',-60),leg('c','d',-60)];
const tied=scheduleTravelLayout([tiedJobs[2],tiedJobs[0],tiedJobs[3],tiedJobs[1]],tiedLegs,timelineRange(tiedJobs));
assert.deepEqual(tied.placed.map(p=>p.job.recordId),['a','b','c','d']);
assert.equal(new Set(tied.connectors.map(c=>c.top+c.labelTop)).size,3,'Each overlapping ETA must have its own clickable row');

// Completed stop -> first stop in a later stack: the arrow must not use the
// bottom of the truck row (which visually points at the second stacked stop).
const stacked=[job('prior',540,600),{...job('first',660,720),stopOrder:0},{...job('second',660,720),stopOrder:1}];
for (const reverseInput of [false,true]) {
  const drawn=scheduleTravelLayout(reverseInput?[...stacked].reverse():stacked,[leg('prior','first',60),leg('first','second',-60)],timelineRange(stacked));
  const incoming=drawn.connectors[0];
  assert.equal(incoming.to.job.recordId,'first');
  assert.equal(incoming.top+incoming.arrowTop!+7,drawn.placed.find(p=>p.job.recordId==='first')!.lane*drawn.laneStep+13,'Incoming arrow lands at first stop center');
  assert.equal(incoming.top,13,'Stack height cannot move the incoming line to the row footer');
  assert.equal(drawn.connectors[1].reverse,false,'Then travel continues down to the second stop');
}
// Different source/target lanes need an elbow in the empty time gap.
const crossing=[job('early1',480,540),job('early2',480,540),job('later1',600,660),job('later2',600,660)];
for(const [from,to] of [['early2','later1'],['early1','later2'],['later1','early2']]) {
  const drawn=scheduleTravelLayout(crossing,[leg(from,to,60)],timelineRange(crossing));
  const c=drawn.connectors[0];
  assert.ok(c.path);
  assert.equal(c.top+c.arrowTop!+7,c.to.lane*drawn.laneStep+13,'Arrow ends on the destination lane in either direction');
  assert.equal(Number(c.path!.split(' ')[0].split(',')[1])+c.top,c.from.lane*drawn.laneStep+13,'Path starts on the source lane');
}
console.log('Gapped arrows follow source and destination lanes, including incoming stacked stops and reverse travel.');

// The displayed start can differ from the booked window once GPS evidence is
// available. A saved Stop Order still owns the vertical order when those two
// rendered blocks overlap.
const actualFirst={...job('2026-09-29:appointment:actual-first',480,540),truck:'Truck 3',stopOrder:0,onsiteTime:{minutes:20,arrival:'2026-09-29T13:20:00.000Z',departure:'2026-09-29T13:40:00.000Z'}} as ScheduleAppointment;
const plannedSecond={...job('2026-09-29:appointment:planned-second',480,540),truck:'Truck 3',stopOrder:1} as ScheduleAppointment;
const orderedStack=scheduleTravelLayout([plannedSecond,actualFirst],[],timelineRange([plannedSecond,actualFirst]),'Truck 3',Date.parse('2026-09-29T14:00:00.000Z'));
assert.deepEqual(orderedStack.placed.map(item=>[item.job.recordId,item.lane]),[[actualFirst.recordId,0],[plannedSecond.recordId,1]],'Saved Stop Order must dictate top and bottom even when GPS changes the displayed start');

const unsavedStack=scheduleTravelLayout([{...actualFirst,stopOrder:undefined},{...plannedSecond,stopOrder:undefined}],[],timelineRange([plannedSecond,actualFirst]),'Truck 3',Date.parse('2026-09-29T14:00:00.000Z'));
assert.deepEqual(unsavedStack.placed.map(item=>item.job.recordId),[plannedSecond.recordId,actualFirst.recordId],'Without a saved order, displayed chronology still chooses the stack order');
console.log('Saved Stop Order controls the visual top-to-bottom stack across planned and GPS-rendered blocks.');

// A phone timeline is narrow enough that the minimum tap width can be longer
// than a short visit's real duration. Pack the rendered footprint, not only the
// underlying time, so sequential appointments never paint over each other.
const mobileVisits=[0,1,2].map(index=>({...job(`2026-09-29:appointment:mobile-${index}`,480+index*60,500+index*60),truck:'Truck 8',status:'Completed',onsiteTime:{minutes:20,arrival:`2026-09-29T${String(13+index).padStart(2,'0')}:00:00.000Z`,departure:`2026-09-29T${String(13+index).padStart(2,'0')}:20:00.000Z`}} as ScheduleAppointment));
const mobileRange=timelineRange(mobileVisits);
const desktopFootprint=scheduleTravelLayout(mobileVisits,[],mobileRange,'Truck 8',Date.parse('2026-09-29T17:00:00.000Z'),1000);
assert.equal(new Set(desktopFootprint.placed.map(item=>item.lane)).size,1,'Wide timelines keep sequential short visits in one lane');
const phoneFootprint=scheduleTravelLayout(mobileVisits,[],mobileRange,'Truck 8',Date.parse('2026-09-29T17:00:00.000Z'),190);
assert.ok(new Set(phoneFootprint.placed.map(item=>item.lane)).size>1,'Narrow timelines separate minimum-width cards before they can overlap');
assert.ok(phoneFootprint.rowHeight>desktopFootprint.rowHeight,'The truck row grows to contain the additional mobile lanes');
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
assert.equal(layout.rowHeight,withoutTravel.rowHeight,'Loading travel times does not expand truck rows');
assert.equal(layout.laneStep,withoutTravel.laneStep,'Travel times do not change lane spacing');
assert.deepEqual(layout.occupiedLanes,withoutTravel.occupiedLanes,'Facility placement remains unchanged when routing loads');
