import assert from 'node:assert/strict';
import {contestedLikelyStops, likelyGpsStop} from '../lib/likely-stop-match';
import {timelineWindow, type ScheduleAppointment} from '../desktop-ui/lib/schedule-contract';
import type {GpsTrip} from '../desktop-ui/lib/gps-route-contract';

// Denham Springs example: booked 8330 Cresson Dr, GPS stop labeled 8830 (11am-noon CDT = 16:00-17:00Z).
const day = '2026-10-22', z = (clock: string) => `${day}T${clock}:00.000Z`;
const yard = {latitude: 30.4, longitude: -91.1}, stopPoint = {latitude: 30.4602, longitude: -90.9581};
const trip = (id: string, dep: string, arr: string, address: string, point = stopPoint, from = yard): GpsTrip =>
  ({id, number: 1, departure: z(dep), arrival: z(arr), from: {...from, address: 'Origin'}, to: {...point, address}});
// Trip b leaves from where trip a ended, so the route is continuous.
const trips = [trip('a', '15:30', '16:05', '8830 Cresson Dr, Denham Springs, LA 70726'), trip('b', '17:03', '17:25', 'Yard, Baton Rouge, LA', yard, stopPoint)];
const job = {status: 'Completed', truck: 'Truck 3', address: '8330 Cresson Dr, Denham Springs, LA 70726', location: null,
  appointmentStartMinutes: 660, appointmentEndMinutes: 720, hasScheduledTime: true};

const stop = likelyGpsStop(job, trips, day)!;
assert.ok(stop, 'one-digit house typo on the same street and town is a likely stop');
assert.equal(stop.arrival, z('16:05')); assert.equal(stop.departure, z('17:03'), 'departure is the next trip start');
assert.equal(stop.confident, true, '58 min dwell then departure on a completed job is inferred');
assert.match(stop.reason, /matched by GPS dwell/);
const brief = likelyGpsStop(job, [trip('a', '15:30', '16:05', '8830 Cresson Dr, Denham Springs, LA 70726'), trip('b', '16:08', '17:25', 'Yard, Baton Rouge, LA', yard, stopPoint)], day)!;
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

// Continuity: a following trip that starts elsewhere cannot supply the departure.
const gap = [trips[0], trip('b', '17:03', '17:25', 'Yard, Baton Rouge, LA', yard, {latitude: 31, longitude: -91})];
const disconnected = likelyGpsStop(job, gap, day)!;
assert.equal(disconnected.departure, null, 'disconnected next trip gives no departure');
assert.equal(disconnected.confident, false, 'unsupported dwell stays unconfirmed');
const lateArrival = [trip('p', '14:00', '15:00', 'Yard, Baton Rouge, LA', yard, yard), trip('a', '15:30', '16:05', '8830 Cresson Dr, Denham Springs, LA 70726', stopPoint, {latitude: 31, longitude: -91}), trips[1]];
assert.equal(likelyGpsStop(job, lateArrival, day)!.confident, false, 'arrival trip that does not start where the previous ended is unconfirmed');
// Locality: no city/ZIP on either side and no pin is not evidence of the same place.
const bare = {...job, address: '8330 Example Dr'};
const bareTrips = [trip('a', '15:30', '16:05', '8830 Example Dr'), trip('b', '17:03', '17:25', 'Yard', yard, stopPoint)];
assert.equal(likelyGpsStop(bare, bareTrips, day), null, 'missing locality without a pin is not matched');
assert.ok(likelyGpsStop({...bare, location: {latitude: 30.4603, longitude: -90.9582}}, bareTrips, day), 'a nearby pin corroborates a bare address');
// Competing claims and existing visits.
const claim = (id: string) => ({job: id, truck: 'Truck 3', likely: stop});
assert.deepEqual([...contestedLikelyStops([claim('x'), claim('y')], [])].sort(), ['x', 'y'], 'two appointments claiming one stop are both contested');
assert.equal(contestedLikelyStops([claim('x')], []).size, 0, 'a single claim stands');
const overlap = {truck: 'Truck 3', start: Date.parse(z('16:30')), end: Date.parse(z('17:00'))};
assert.equal(contestedLikelyStops([claim('x')], [overlap]).has('x'), true, 'overlap with an existing confirmed visit is contested');
assert.equal(contestedLikelyStops([claim('x')], [{...overlap, truck: 'Truck 4'}]).size, 0, 'another truck is not a conflict');

const appt = {recordId: `${day}:appointment:1`, status: 'Completed', truck: 'Truck 3', hasScheduledTime: true, appointmentStartMinutes: 660, appointmentEndMinutes: 720,
  appointmentTime: '11:00 AM–12:00 PM', truckVisitGaps: [], likelyStop: {...stop, confident: false}} as unknown as ScheduleAppointment;
const window = timelineWindow(appt, 'Truck 3') as {actual: boolean; likely?: boolean; start: number; end: number; label: string};
assert.equal(window.likely, true); assert.equal(window.actual, true);
assert.equal(window.start, 11 * 60 + 5); assert.equal(window.end, 12 * 60 + 3, 'block spans the GPS stop, not the booking');
assert.match(window.label, /Likely stop.*needs review/);
assert.equal((timelineWindow({...appt, likelyStop: undefined}, 'Truck 3') as {label: string}).label, 'Planned · booked window');
console.log('Likely stop match passed: near-house typo, guards, ambiguity, stop-sized timeline block.');
