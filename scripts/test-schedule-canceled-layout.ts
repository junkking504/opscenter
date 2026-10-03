import assert from 'node:assert/strict';
import { scheduleTravelLayout } from '../desktop-ui/lib/schedule-travel-layout';
import { timelineRange, type ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';
const job = (id: string, start: number, end: number) => ({ recordId: id, truck: 'Unassigned', appointmentStartMinutes: start, appointmentEndMinutes: end, hasScheduledTime: true } as ScheduleAppointment);
// Cancellation lanes stay below all active windows, including non-overlapping ones.
const cancellationJobs = [
  {...job('cancel-early',480,540),status:'Canceled'},
  {...job('active-a',600,660),status:'Confirmed'},
  {...job('active-b',600,660),status:'Confirmed'},
  {...job('cancel-late',720,780),status:'Cancelled'},
];
for (const mobile of [false,true]) {
  const packed = scheduleTravelLayout(cancellationJobs,[],timelineRange(cancellationJobs),'Unassigned',0,640,false,mobile);
  assert.equal(packed.placed.length,4,'All appointments remain visible');
  const activeLanes = packed.placed.filter(p=>p.job.status==='Confirmed').flatMap(p=>p.segmentLanes);
  const canceled = packed.placed.filter(p=>/cancel/i.test(p.job.status));
  assert.ok(canceled.every(p=>p.segmentLanes.every(lane=>lane>Math.max(...activeLanes))), 'Every cancellation is below all confirmed appointments regardless of time');
  assert.equal(canceled[0].lane,canceled[1].lane,'Non-overlapping cancellations can share their bottom lane');
  assert.ok(packed.placed.every(p=>p.position.start===p.job.appointmentStartMinutes),'Grouping does not change booked time');
}
console.log('Unassigned cancellations stay below confirmed appointments on desktop and mobile.');
