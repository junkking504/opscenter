import assert from 'node:assert/strict';
import { currentGpsPresence } from '../lib/schedule-gps-presence';
const now = Date.parse('2026-09-10T16:02:00Z');
const job = { appointmentId: 'one', location: { latitude: 29.97, longitude: -90.07 }, appointmentStartMinutes: 660, appointmentEndMinutes: 720, status: 'Confirmed' };
const points = [0,1,2,3].map(i => ({ ...job.location, timestamp: new Date(now - (3-i)*60_000).toISOString(), continuousUntil: null }));
const truck = { truck: 'Truck# 3', ...job.location, lastGpsUpdate: points.at(-1)!.timestamp, routePoints: points };
assert.equal(currentGpsPresence(job, [truck], [job], now)?.truck, 'Truck 3');
assert.equal(currentGpsPresence(job, [{ ...truck, routePoints: points.slice(-1) }], [job], now), undefined, 'A single nearby report cannot prove dwell');
assert.equal(currentGpsPresence(job, [{ ...truck, routePoints: [] }], [job], now), undefined, 'Missing route evidence cannot prove continuous presence');
assert.equal(currentGpsPresence(job, [truck], [job], now + 11*60_000)?.current, false, 'Preserve stale position as last reported, never current');
const parked = {...truck, speed: 0, ignition: 'OFF'};
assert.equal(currentGpsPresence(job, [parked], [job], now + 42*60_000)?.current, false, 'Parked tolerance cannot extend current on-site presence');
assert.equal(currentGpsPresence(job, [parked], [job], now + 75*60_000)?.current, false, 'A parked heartbeat is last known location, not current dwell');
assert.equal(currentGpsPresence(job, [parked], [job], now + 76*60_000)?.current, false, 'A missed parked heartbeat remains last reported, not current');
assert.equal(currentGpsPresence(job, [{...parked, ignition:'ON'}], [job], now + 42*60_000)?.current, false, 'An idling truck does not receive the engine-off reporting allowance');
assert.equal(currentGpsPresence(job, [{...parked, latitude:30.4}], [job], now + 42*60_000), undefined, 'A newer stopped position elsewhere is not still on site');
assert.equal(currentGpsPresence({...job, onsiteTime:{departure:truck.lastGpsUpdate}}, [parked], [job], now + 42*60_000), undefined, 'Confirmed departure must prevent an older parked report from restoring on site');
assert.equal(currentGpsPresence(job, [truck], [job], now + 13*3600_000), undefined, 'Old history must not become today current presence');
assert.equal(currentGpsPresence(job, [truck], [job, { ...job, appointmentId: 'two' }], now), undefined, 'Two nearby appointments cannot be assigned the same inferred visit');
assert.equal(currentGpsPresence(job, [truck, { ...truck, truck: 'Truck 6' }], [job], now), undefined, 'Multiple trucks need resolved visit evidence');
assert.equal(currentGpsPresence(job, [{ ...truck, latitude: 30.4 }], [job], now), undefined, 'Current position outside clears fallback');
assert.equal(currentGpsPresence({ ...job, status: 'Completed' }, [truck], [job], now), undefined);
assert.equal(currentGpsPresence(job, [{ ...truck, routePoints: [{ ...points[0], timestamp: new Date(now-30*60_000).toISOString() }, points[3]] }], [job], now), undefined, 'Do not invent continuity across an outage');
assert.equal(currentGpsPresence({ ...job, location: null }, [truck], [job], now), undefined);
assert.equal(currentGpsPresence(job, [{ ...truck, latitude: NaN }], [job], now), undefined, 'Invalid coordinates cannot indicate presence');
assert.equal(currentGpsPresence(job, [{ ...truck, lastGpsUpdate: new Date(now + 120_000).toISOString() }], [job], now), undefined, 'Future reports cannot indicate presence');
console.log('GPS presence: continuous dwell, missing history, parked/stale GPS, ambiguity and closed jobs passed.');
const early = { ...job, truck: 'Truck# 3', appointmentStartMinutes: 780, appointmentEndMinutes: 840 };
assert.equal(currentGpsPresence(early, [truck], [early], now)?.truck, 'Truck 3', 'An assigned crew physically onsite may arrive more than ninety minutes early');
assert.equal(currentGpsPresence({ ...early, truck: 'Unassigned' }, [truck], [{ ...early, truck: 'Unassigned' }], now), undefined, 'An unrelated early pass must not become an appointment arrival');

assert.equal(currentGpsPresence(job, [parked], [job], now + 3*60_000)?.current, true);
assert.equal(currentGpsPresence(job, [parked], [job], now + 3*60_000 + 1)?.current, false, 'Current presence ends after three minutes for parked trucks too');

const reassigned={...job,truck:'Truck 9'};
const observed=currentGpsPresence(reassigned,[{...parked,truck:'Truck 8'},{...parked,truck:'Truck 9',latitude:30.4}],[reassigned],now+24*60_000);
assert.equal(observed?.truck,'Truck 8','Physical parked presence wins over the booked truck');
assert.equal(observed?.parked,true);
assert.equal(observed?.observedAt,parked.lastGpsUpdate,'Keep original GPS time visible');

const outside = {...points[1], latitude:30.4};
assert.equal(currentGpsPresence(job,[{...truck,routePoints:[points[0],outside,points[3]]}],[job],now),undefined,'A newer away point resets the dwell');
const bridge=[{...points[0],timestamp:new Date(now-20*60_000).toISOString(),continuousUntil:truck.lastGpsUpdate},points[3]];
assert.equal(currentGpsPresence(job,[{...truck,routePoints:bridge}],[job],now)?.current,true,'Source-confirmed continuous stop can cover a sparse interval');
assert.equal(currentGpsPresence(job,[{...truck,routePoints:[...points].reverse()}],[job],now)?.current,true,'Source point order cannot change dwell');
assert.equal(currentGpsPresence({...job,onsiteTime:{departure:new Date(now-30_000).toISOString()}},[truck],[job],now),undefined,'A return after departure must establish new dwell');

assert.equal(currentGpsPresence(job,[{...truck,lastGpsUpdate:new Date(now+1).toISOString()}],[job],now),undefined,'Even a slightly future observation cannot establish current presence');
