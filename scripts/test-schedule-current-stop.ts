import assert from 'node:assert/strict';
import { scheduleTravelLayout } from '../desktop-ui/lib/schedule-travel-layout';
import { timelineRange, type ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';
const job = (id: string, start: number, end: number) => ({ recordId: id, appointmentStartMinutes: start, appointmentEndMinutes: end, hasScheduledTime: true } as ScheduleAppointment);

// A current visit can start after upcoming booked windows. It still belongs at
// the top, even when its booked window differs from the saved upcoming group.
const currentNow=Date.parse('2026-10-03T14:30:00Z');
const currentVisit={...job('2026-10-03:appointment:current',480,540),truck:'Truck 4',status:'Confirmed',truckOnSite:true,onsiteTruck:'Truck# 4',truckVisits:[{truck:'Truck 4',arrival:'2026-10-03T14:10:00Z',departure:null,observedThrough:'2026-10-03T14:11:00Z',currentUntil:'2026-10-03T15:00:00Z'}]} as ScheduleAppointment;
const upcoming=[{...job('next',540,600),truck:'Truck 4',stopOrder:0},{...job('later',540,600),truck:'Truck 4',stopOrder:1}];
for (const mobile of [false,true]) {
  const input=[upcoming[1],currentVisit,upcoming[0]];
  const before=JSON.stringify(input);
  const drawn=scheduleTravelLayout(input,[],timelineRange(input,currentNow),'Truck 4',currentNow,mobile?190:720,!mobile,mobile);
  assert.deepEqual(drawn.placed.map(p=>[p.job.recordId,p.lane]),[[currentVisit.recordId,0],['next',1],['later',2]]);
  assert.equal(drawn.placed[0].position.start,550,'GPS start stays at 9:10');
  assert.equal(JSON.stringify(input),before,'Visual priority never changes assignments, bookings or saved stop order');
}
const historical={...currentVisit,truckOnSite:false,truckVisits:currentVisit.truckVisits!.map(v=>({...v,currentUntil:undefined})),lastSeenOnsiteTruck:'Truck 4'};
assert.equal(scheduleTravelLayout([...upcoming,historical],[],timelineRange([...upcoming,historical]),'Truck 4',currentNow).placed[0].job.recordId,'next','Last-reported presence is not a current visit');
const elsewhere={...currentVisit,truckOnSite:true,onsiteTruck:'Truck 9',truckVisits:undefined,appointmentStartMinutes:550,appointmentEndMinutes:570};
assert.equal(scheduleTravelLayout([...upcoming,elsewhere],[],timelineRange([...upcoming,elsewhere]),'Truck 4',currentNow).placed[0].job.recordId,'next','Presence on another truck must not promote this assignment');
const atJob={...elsewhere,truckOnSite:false,truckAtJob:true,atJobTruck:'Truck 4'};
assert.equal(scheduleTravelLayout([...upcoming,atJob],[],timelineRange([...upcoming,atJob]),'Truck 4',currentNow).placed[0].job.recordId,atJob.recordId,'Current parked location also takes the top lane');
console.log('Current appointments take the top lane on desktop/mobile while upcoming order, times and source data remain intact.');

