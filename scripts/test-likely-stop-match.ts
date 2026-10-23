import assert from 'node:assert/strict';
import {normalizeTruckGpsRoute} from '../lib/desktop-gps-route';
import {contestedLikelyStops, likelyGpsStop} from '../lib/likely-stop-match';
import {timelineWindow, type ScheduleAppointment} from '../desktop-ui/lib/schedule-contract';
import type {GpsTrip} from '../desktop-ui/lib/gps-route-contract';

// Denham Springs example: booked 8330 Cresson Dr, GPS stop labeled 8830 (11am-noon CDT = 16:00-17:00Z).
const day = '2026-10-22', z = (clock: string) => `${day}T${clock}:00.000Z`;
const yard = {latitude: 30.4, longitude: -91.1}, stopPoint = {latitude: 30.4602, longitude: -90.9581};
const trip = (id: string, dep: string, arr: string, address: string, point = stopPoint, from = yard): GpsTrip =>
  ({id, number: 1, departure: z(dep), arrival: z(arr), from: {...from, address: 'Origin'}, to: {...point, address}});
const fix = (clock: string, point = stopPoint) => ({timestamp: z(clock), ...point});
const fixes = ['16:05', '16:15', '16:25', '16:35', '16:45', '16:55', '17:03'].map(clock => fix(clock));
// Trip b leaves from where trip a ended, so the route is continuous.
const trips = [trip('a', '15:30', '16:05', '8830 Cresson Dr, Denham Springs, LA 70726'), trip('b', '17:03', '17:25', 'Yard, Baton Rouge, LA', yard, stopPoint)];
const job = {status: 'Completed', truck: 'Truck 3', address: '8330 Cresson Dr, Denham Springs, LA 70726', location: null,
  appointmentStartMinutes: 660, appointmentEndMinutes: 720, hasScheduledTime: true};

const stop = likelyGpsStop(job, trips, day, fixes)!;
assert.ok(stop, 'one-digit house typo on the same street and town is a likely stop');
assert.equal(stop.arrival, z('16:05')); assert.equal(stop.departure, z('17:03'), 'departure is the next trip start');
assert.equal(stop.confident, true, '58 min dwell then departure on a completed job is inferred');
assert.match(stop.reason, /matched by GPS dwell/);
const brief = likelyGpsStop(job, [trip('a', '15:30', '16:05', '8830 Cresson Dr, Denham Springs, LA 70726'), trip('b', '16:08', '17:25', 'Yard, Baton Rouge, LA', yard, stopPoint)], day, fixes)!;
assert.equal(brief.confident, false, '3 min stop is only a suggestion');
assert.equal(likelyGpsStop(job, [trips[0]], day, fixes)!.confident, false, 'no departure yet stays a suggestion');
assert.ok(likelyGpsStop({...job, address: '8380 Cresson Dr, Denham Springs, LA 70726'}, trips, day, fixes), 'transposed digits');
assert.equal(likelyGpsStop({...job, address: '8720 Cresson Dr, Denham Springs, LA 70726'}, trips, day, fixes), null, 'two digits off is not a near match');
assert.equal(likelyGpsStop({...job, address: '8330 Cresson Dr, Walker, LA 70785'}, trips, day, fixes), null, 'different town');
assert.equal(likelyGpsStop({...job, address: '8330 Other St, Denham Springs, LA 70726'}, trips, day, fixes), null, 'different street');
assert.equal(likelyGpsStop({...job, appointmentStartMinutes: 900, appointmentEndMinutes: 960}, trips, day, fixes), null, 'stop far from booked window');
assert.equal(likelyGpsStop({...job, truck: 'Unassigned'}, trips, day, fixes), null, 'needs an assigned truck');
assert.equal(likelyGpsStop({...job, status: 'Canceled'}, trips, day, fixes), null);
assert.equal(likelyGpsStop({...job, location: {latitude: 30.9, longitude: -91.5}}, trips, day, fixes), null, 'known pin far from the stop');
assert.ok(likelyGpsStop({...job, location: {latitude: 30.4603, longitude: -90.9582}}, trips, day, fixes)?.reason.includes('400 m'));
assert.equal(likelyGpsStop(job, [...trips, trip('c', '16:20', '16:30', '8430 Cresson Dr, Denham Springs, LA 70726')], day, fixes), null, 'two different candidate stops are ambiguous');

// Continuity: a following trip that starts elsewhere cannot supply the departure.
const gap = [trips[0], trip('b', '17:03', '17:25', 'Yard, Baton Rouge, LA', yard, {latitude: 31, longitude: -91})];
const disconnected = likelyGpsStop(job, gap, day, fixes)!;
assert.equal(disconnected.departure, null, 'disconnected next trip gives no departure');
assert.equal(disconnected.confident, false, 'unsupported dwell stays unconfirmed');
const lateArrival = [trip('p', '14:00', '15:00', 'Yard, Baton Rouge, LA', yard, yard), trip('a', '15:30', '16:05', '8830 Cresson Dr, Denham Springs, LA 70726', stopPoint, {latitude: 31, longitude: -91}), trips[1]];
assert.equal(likelyGpsStop(job, lateArrival, day, fixes)!.confident, true, 'an earlier route gap does not veto a dwell the stop\'s own fixes support');
// Locality: no city/ZIP on either side and no pin is not evidence of the same place.
const bare = {...job, address: '8330 Example Dr'};
const bareTrips = [trip('a', '15:30', '16:05', '8830 Example Dr'), trip('b', '17:03', '17:25', 'Yard', yard, stopPoint)];
assert.equal(likelyGpsStop(bare, bareTrips, day, fixes), null, 'missing locality without a pin is not matched');
assert.ok(likelyGpsStop({...bare, location: {latitude: 30.4603, longitude: -90.9582}}, bareTrips, day, fixes), 'a nearby pin corroborates a bare address');
// Coverage: a silent stretch, or a fix elsewhere, during the dwell is not presence.
const sparse = [fix('16:05'), fix('17:03')];
assert.equal(likelyGpsStop(job, trips, day, sparse)!.confident, false, '58 min with no fixes is unsupported');
assert.equal(likelyGpsStop(job, trips, day, sparse)!.departure, null);
const away = [...fixes, fix('16:40', {latitude: 30.6, longitude: -90.9})];
assert.equal(likelyGpsStop(job, trips, day, away)!.confident, false, 'a fix elsewhere during the dwell breaks presence');
assert.equal(likelyGpsStop(job, trips, day)!.confident, false, 'no fix data cannot confirm a dwell');
// Positive evidence: short stops need fixes too, and a stationary fix covers its recorded span.
const shortTrips = (mins: number) => [trip('a', '15:30', '16:05', '8830 Cresson Dr, Denham Springs, LA 70726'), trip('b', `16:${String(5 + mins).padStart(2, '0')}`, '17:25', 'Yard, Baton Rouge, LA', yard, stopPoint)];
for (const mins of [5, 10, 20]) {
  assert.equal(likelyGpsStop(job, shortTrips(mins), day, [])!.confident, false, `${mins} min with no fixes is unsupported`);
  assert.equal(likelyGpsStop(job, shortTrips(mins), day, [fix('16:05'), fix(`16:${String(5 + mins).padStart(2, '0')}`)])!.confident, true, `${mins} min with fixes at both ends`);
}
const compressed = [{...fix('16:05'), coveredUntil: z('16:30')}];
assert.equal(likelyGpsStop(job, [trips[0], trip('b', '16:30', '17:25', 'Yard, Baton Rouge, LA', yard, stopPoint)], day, compressed)!.confident, true, 'a stationary fix covers its recorded span');
assert.equal(likelyGpsStop(job, trips, day, compressed)!.confident, false, 'coverage that ends early leaves the rest of the dwell unsupported');
// Normalization keeps point geometry identical to paths; coverage travels separately.
const raw = (clock: string, extra = {}) => ({truck_number: '3', timestamp: z(clock), latitude: 30.4602, longitude: -90.9581, ...extra});
const route = normalizeTruckGpsRoute({collection_timestamp: z('20:00'), points: [raw('16:05', {continuous_until: z('16:30')}), raw('16:31')]}, day, 'Truck 3', Date.parse(z('21:00')));
assert.ok(route.points.every(point => !('coveredUntil' in point)), 'points are unchanged by coverage');
assert.deepEqual(route.coverage, [{timestamp: z('16:05'), latitude: 30.4602, longitude: -90.9581, coveredUntil: z('16:30')}]);
const twin = normalizeTruckGpsRoute({collection_timestamp: z('20:00'), points: [raw('16:00', {continuous_until: z('16:10')}), raw('16:00', {latitude: 30.46021, continuous_until: z('17:03')})]}, day, 'Truck 3', Date.parse(z('21:00')));
assert.equal(twin.coverage?.length, 2, 'equal timestamps with different coordinates keep separate coverage');
assert.deepEqual(twin.coverage?.map(row => [row.latitude, row.coveredUntil]), [[30.4602, z('16:10')], [30.46021, z('17:03')]]);
// Competing claims and existing visits.
const claim = (id: string) => ({job: id, truck: 'Truck 3', likely: stop});
assert.deepEqual([...contestedLikelyStops([claim('x'), claim('y')], [])].sort(), ['x', 'y'], 'two appointments claiming one stop are both contested');
assert.equal(contestedLikelyStops([claim('x')], []).size, 0, 'a single claim stands');
const overlap = {truck: 'Truck 3', start: Date.parse(z('16:30')), end: Date.parse(z('17:00'))};
assert.equal(contestedLikelyStops([claim('x')], [overlap]).has('x'), true, 'overlap with an existing confirmed visit is contested');
const point = {truck: 'Truck 3', start: Date.parse(stop.arrival), end: Date.parse(stop.arrival)};
assert.equal(contestedLikelyStops([claim('x')], [point]).has('x'), true, 'a confirmed single-point visit at the same arrival owns the stop');
assert.equal(contestedLikelyStops([claim('x')], [{...overlap, truck: 'Truck 4'}]).size, 0, 'another truck is not a conflict');

const appt = {recordId: `${day}:appointment:1`, status: 'Completed', truck: 'Truck 3', hasScheduledTime: true, appointmentStartMinutes: 660, appointmentEndMinutes: 720,
  appointmentTime: '11:00 AM–12:00 PM', truckVisitGaps: [], likelyStop: {...stop, confident: false}} as unknown as ScheduleAppointment;
const window = timelineWindow(appt, 'Truck 3') as {actual: boolean; likely?: boolean; start: number; end: number; label: string};
assert.equal(window.likely, true); assert.equal(window.actual, true);
assert.equal(window.start, 11 * 60 + 5); assert.equal(window.end, 12 * 60 + 3, 'block spans the GPS stop, not the booking');
assert.match(window.label, /Likely stop.*needs review/);
assert.equal((timelineWindow({...appt, likelyStop: undefined}, 'Truck 3') as {label: string}).label, 'Planned · booked window');
console.log('Likely stop match passed: near-house typo, guards, ambiguity, stop-sized timeline block.');
