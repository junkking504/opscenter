import assert from 'node:assert/strict';
import { currentGpsJobLocation, currentGpsPresence } from '../lib/schedule-gps-presence';
const now = Date.parse('2026-09-10T16:02:00Z');
const job = { appointmentId: 'one', location: { latitude: 29.97, longitude: -90.07 }, appointmentStartMinutes: 660, appointmentEndMinutes: 720, status: 'Confirmed' };
const points = [0,1,2,3].map(i => ({ ...job.location, timestamp: new Date(now - (3-i)*60_000).toISOString(), continuousUntil: null }));
const truck = { truck: 'Truck# 3', ...job.location, lastGpsUpdate: points.at(-1)!.timestamp, routePoints: points };
assert.equal(currentGpsPresence(job, [truck], [job], now)?.truck, 'Truck 3');
assert.equal(currentGpsPresence(job, [{ ...truck, routePoints: points.slice(-1) }], [job], now), undefined, 'A single nearby report cannot prove dwell');
assert.equal(currentGpsPresence(job, [{ ...truck, routePoints: [] }], [job], now), undefined, 'Missing route evidence cannot prove continuous presence');
assert.equal(currentGpsPresence(job, [truck], [job], now + 11*60_000)?.current, false, 'Preserve stale position as last reported, never current');
const parked = {...truck, speed: 0, ignition: 'OFF'};
const assignedJob = {...job, truck:'Truck #3'};
const singlePointParked = {...parked, routePoints:points.slice(-1)};
assert.equal(currentGpsPresence(assignedJob,[singlePointParked],[assignedJob],now),undefined,'A single parked point still cannot prove dwell');
assert.deepEqual(currentGpsJobLocation(assignedJob,[singlePointParked],[assignedJob],now),{truck:'Truck 3',observedAt:truck.lastGpsUpdate,parked:true},'A timestamped parked report can confirm the assigned truck location without inventing dwell');
assert.deepEqual(currentGpsJobLocation({...assignedJob,status:'Completed'},[singlePointParked],[{...assignedJob,status:'Completed'}],now),{truck:'Truck 3',observedAt:truck.lastGpsUpdate,parked:true},'Completing the source record does not erase the truck location');
assert.equal(currentGpsJobLocation({...assignedJob,status:'Canceled'},[singlePointParked],[{...assignedJob,status:'Canceled'}],now),undefined,'Canceled work cannot claim a truck location');
assert.equal(currentGpsJobLocation({...assignedJob,truck:'Unassigned'},[singlePointParked],[{...assignedJob,truck:'Unassigned'}],now),undefined,'Location-only confirmation requires the assigned truck');
assert.equal(currentGpsJobLocation(assignedJob,[{...singlePointParked,ignition:'ON'}],[assignedJob],now),undefined,'A non-parked point can be a pass-by and does not qualify');
assert.equal(currentGpsJobLocation(assignedJob,[singlePointParked],[assignedJob,{...assignedJob,appointmentId:'nearby'}],now),undefined,'Two assigned jobs at the same place remain ambiguous');
assert.equal(currentGpsJobLocation({...assignedJob,onsiteTime:{departure:truck.lastGpsUpdate}},[singlePointParked],[assignedJob],now),undefined,'A recorded departure supersedes the parked location report');
assert.equal(currentGpsJobLocation(assignedJob,[singlePointParked],[assignedJob],now+76*60_000),undefined,'A missed parked heartbeat cannot remain at job');
assert.equal(currentGpsJobLocation(assignedJob,[{...singlePointParked,latitude:30.4}],[assignedJob],now),undefined,'A newer parked report elsewhere cannot claim the job location');
assert.equal(currentGpsPresence(job, [parked], [job], now + 42*60_000)?.current, true, 'Established parked presence survives the normal heartbeat interval');
assert.equal(currentGpsPresence(job, [parked], [job], now + 75*60_000)?.current, true, 'Established parked presence remains on site through the heartbeat limit');
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
assert.equal(currentGpsPresence(job, [parked], [job], now + 3*60_000 + 1)?.current, true, 'Parked on-site status does not flicker after three minutes');

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

// Reproduce an established stop followed by hourly ignition-off heartbeats.
const stoppedPoints = points.map(p => ({...p,speed:0,ignition:'OFF',deliverySource:'v3_position_push'}));
const hourlyStamp = new Date(now+60*60_000).toISOString();
const hourly = {...parked,lastGpsUpdate:hourlyStamp,routePoints:[...stoppedPoints,{...stoppedPoints.at(-1)!,timestamp:hourlyStamp}]};
const afterHeartbeat = now+70*60_000;
assert.equal(currentGpsPresence(job,[hourly],[job],afterHeartbeat)?.current,true,'An hourly heartbeat preserves the previously established visit');
assert.equal(currentGpsPresence(job,[hourly],[job],afterHeartbeat)?.observedAt,hourlyStamp,'Preserve the actual tracker timestamp');
assert.equal(currentGpsPresence(job,[{...hourly,routePoints:hourly.routePoints.slice(-2)}],[job],afterHeartbeat),undefined,'Two sparse parked reports cannot establish initial dwell');
const interrupted = {...stoppedPoints.at(-1)!,timestamp:new Date(now+30*60_000).toISOString()};
for (const changed of [{...interrupted,latitude:30.4},{...interrupted,ignition:'ON'},{...interrupted,speed:20}]) {
  assert.equal(currentGpsPresence(job,[{...hourly,routePoints:[...stoppedPoints,changed]}],[job],afterHeartbeat),undefined,'A departure or ignition/motion transition breaks parked retention');
}
const lateHeartbeat = {...hourly,lastGpsUpdate:new Date(now+76*60_000).toISOString(),routePoints:stoppedPoints};
assert.equal(currentGpsPresence(job,[lateHeartbeat],[job],now+80*60_000),undefined,'An uncovered missed heartbeat cannot extend old dwell');
assert.equal(currentGpsPresence({...job,onsiteTime:{departure:new Date(now+30*60_000).toISOString()}},[hourly],[job],afterHeartbeat),undefined,'A recorded departure requires a new established visit');
assert.equal(currentGpsPresence(job,[{...hourly,routePoints:[...stoppedPoints,{...stoppedPoints.at(-1)!,ignition:null,deliverySource:'v2_poll'}]}],[job],afterHeartbeat)?.current,true,'Fallback duplicates cannot mask authoritative engine-off evidence');
assert.equal(currentGpsPresence(job,[hourly],[job,{...job,appointmentId:'nearby'}],afterHeartbeat),undefined,'Parked retention preserves appointment ambiguity checks');
console.log('Parked heartbeat regression passed: established dwell, hourly continuation, departure, motion, missed reports and source precedence.');

const engineOn = {...hourly,ignition:'ON',lastGpsUpdate:new Date(now+61*60_000).toISOString()};
assert.equal(currentGpsPresence(job,[engineOn],[job],now+62*60_000)?.current,true,'Starting the engine at the same site does not invent a departure');
assert.equal(currentGpsPresence(job,[engineOn],[job],now+65*60_000)?.current,false,'Engine-on reports still require fresh motion telemetry');

const shutdownPoint = {...job.location,timestamp:new Date(now-7_000).toISOString(),speed:0,ignition:'ON'};
const shutdown = {...parked,routePoints:[shutdownPoint]};
assert.equal(currentGpsPresence(job,[shutdown],[job],now+10*60_000)?.current,true,'Stationary engine shutdown establishes arrival without waiting for an hourly heartbeat');
assert.equal(currentGpsPresence(job,[shutdown],[job],now)?.arrival,shutdownPoint.timestamp,'Use the observed stationary arrival, not wall-clock elapsed time');
assert.equal(currentGpsPresence(job,[{...shutdown,lastGpsUpdate:hourlyStamp,routePoints:[shutdownPoint,{...job.location,timestamp:truck.lastGpsUpdate,speed:0,ignition:'OFF'}]}],[job],afterHeartbeat)?.current,true,'Hourly parked reports retain a shutdown-established arrival');
for (const previous of [{...shutdownPoint,speed:20},{...shutdownPoint,ignition:'OFF'}, {...shutdownPoint,latitude:30.4}, {...shutdownPoint,timestamp:new Date(now-6*60_000).toISOString()}]) {
  assert.equal(currentGpsPresence(job,[{...shutdown,routePoints:[previous]}],[job],now),undefined,'Moving, sparse, distant or repeated OFF reports cannot establish an initial shutdown arrival');
}
assert.equal(currentGpsPresence(job,[shutdown],[job,{...job,appointmentId:'neighbor'}],now),undefined,'Shutdown arrival retains appointment ambiguity checks');
assert.equal(currentGpsPresence({...job,onsiteTime:{departure:truck.lastGpsUpdate}},[shutdown],[job],now),undefined,'A recorded departure cannot be undone by an older shutdown');

for (const speed of [1,2]) {
  const creeping = {...shutdown,routePoints:[{...shutdownPoint,speed}]};
  assert.equal(currentGpsPresence(job,[creeping],[job],now+25*60_000)?.current,true,'Parking-speed arrival followed by engine shutdown establishes on-site presence');
}
for (const speed of [-1,3,NaN]) {
  assert.equal(currentGpsPresence(job,[{...shutdown,routePoints:[{...shutdownPoint,speed}]}],[job],now),undefined,'Invalid or faster motion cannot qualify as shutdown dwell');
}
assert.equal(currentGpsPresence(job,[{...shutdown,routePoints:[{...shutdownPoint,speed:1,latitude:job.location.latitude+0.0005}]}],[job],now),undefined,'Parking-speed fixes more than 30 meters apart cannot establish a stop');
