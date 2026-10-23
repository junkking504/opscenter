import assert from 'node:assert/strict';
import {likelyGpsStop,likelyStopHasConflict} from '../lib/likely-stop-match';
import {timelineWindow, type ScheduleAppointment} from '../desktop-ui/lib/schedule-contract';
import type {GpsTrip} from '../desktop-ui/lib/gps-route-contract';

// Denham Springs example: booked 8330 Cresson Dr, GPS stop labeled 8830 (11am-noon CDT = 16:00-17:00Z).
const day = '2026-10-22', z = (clock: string) => `${day}T${clock}:00.000Z`;
const trip = (id: string, dep: string, arr: string, address: string, point = {latitude: 30.4602, longitude: -90.9581}): GpsTrip =>
  ({id, number: 1, departure: z(dep), arrival: z(arr), from: {latitude: 30.4, longitude: -91.1, address: 'Yard'}, to: {...point, address}});
const trips = [trip('a', '15:30', '16:05', '8830 Cresson Dr, Denham Springs, LA 70726'), trip('b', '17:03', '17:25', 'Yard, Baton Rouge, LA')];
trips[1] = {...trips[1], number:2, from:trips[0].to};
const broken = [{...trips[0]}, {...trips[1], from:{latitude:31,longitude:-91,address:'Elsewhere'}}];
const job = {status: 'Completed', truck: 'Truck 3', address: '8330 Cresson Dr, Denham Springs, LA 70726', location: null,
  appointmentStartMinutes: 660, appointmentEndMinutes: 720, hasScheduledTime: true};

for (const rows of [broken, [trips[0], {...trips[1],number:3}], [trips[0], {...trips[1],from:{...trips[0].to,address:'Other address'}}]]) {
  assert.equal(likelyGpsStop(job,rows,day)?.confident,false,'Missing trip continuity cannot invent onsite dwell');
  assert.equal(likelyGpsStop(job,rows,day)?.departure,null);
}
assert.equal(likelyGpsStop(job,[{...trips[0],arrival:'invalid'},trips[1]],day),null);
const stop = likelyGpsStop(job, trips, day)!;
assert.ok(stop, 'one-digit house typo on the same street and town is a likely stop');
assert.equal(stop.arrival, z('16:05')); assert.equal(stop.departure, z('17:03'), 'departure is the next trip start');
assert.equal(stop.confident, true, '58 min dwell then departure on a completed job is inferred');
assert.match(stop.reason, /matched by GPS dwell/);
assert.equal(likelyStopHasConflict(stop,[{truck:'Truck# 3',arrival:z('16:10'),departure:z('16:40')}]),true,'One physical stop cannot claim two appointments');
assert.equal(likelyStopHasConflict(stop,[{truck:'Truck 3',arrival:stop.arrival,departure:stop.arrival}]),true,'An existing single GPS observation owns that stop too');
assert.equal(likelyStopHasConflict(stop,[{truck:'Truck 4',arrival:stop.arrival,departure:stop.departure}]),false);
assert.equal(likelyStopHasConflict(stop,[{truck:'Truck 3',arrival:z('17:04'),departure:z('17:10')}]),false);
const brief = likelyGpsStop(job, [trips[0], {...trips[1], departure:z('16:08')}], day)!;
assert.equal(brief.confident, false, '3 min stop is only a suggestion');
assert.equal(likelyGpsStop(job, [trips[0]], day)!.confident, false, 'no departure yet stays a suggestion');
assert.ok(likelyGpsStop({...job, address: '8380 Cresson Dr, Denham Springs, LA 70726'}, trips, day), 'transposed digits');
assert.equal(likelyGpsStop({...job, address: '8720 Cresson Dr, Denham Springs, LA 70726'}, trips, day), null, 'two digits off is not a near match');
assert.equal(likelyGpsStop({...job, address: '8330 Cresson Dr, Walker, LA 70785'}, trips, day), null, 'different town');
assert.equal(likelyGpsStop({...job, address: '8330 Other St, Denham Springs, LA 70726'}, trips, day), null, 'different street');
assert.equal(likelyGpsStop({...job, appointmentStartMinutes: 900, appointmentEndMinutes: 960}, trips, day), null, 'stop far from booked window');
assert.equal(likelyGpsStop({...job, truck: 'Unassigned'}, trips, day), null, 'needs an assigned truck');
assert.equal(likelyGpsStop({...job, status: 'Canceled'}, trips, day), null);
assert.equal(likelyGpsStop({...job, location: {latitude: 30.9, longitude: -91.5}}, trips, day), null, 'known pin far from the stop');
assert.ok(likelyGpsStop({...job, location: {latitude: 30.4603, longitude: -90.9582}}, trips, day)?.reason.includes('400 m'));
assert.equal(likelyGpsStop(job, [...trips, trip('c', '16:20', '16:30', '8430 Cresson Dr, Denham Springs, LA 70726')], day), null, 'two different candidate stops are ambiguous');

const appt = {recordId: `${day}:appointment:1`, status: 'Completed', truck: 'Truck 3', hasScheduledTime: true, appointmentStartMinutes: 660, appointmentEndMinutes: 720,
  appointmentTime: '11:00 AM–12:00 PM', truckVisitGaps: [], likelyStop: {...stop, confident: false}} as unknown as ScheduleAppointment;
const window = timelineWindow(appt, 'Truck 3') as {actual: boolean; likely?: boolean; start: number; end: number; label: string};
assert.equal(window.likely, true); assert.equal(window.actual, true);
assert.equal(window.start, 11 * 60 + 5); assert.equal(window.end, 12 * 60 + 3, 'block spans the GPS stop, not the booking');
assert.match(window.label, /Likely stop.*needs review/);
assert.equal((timelineWindow({...appt, likelyStop: undefined}, 'Truck 3') as {label: string}).label, 'Planned · booked window');
console.log('Likely stop match passed: near-house typo, guards, ambiguity, stop-sized timeline block.');
