import assert from 'node:assert/strict';
import { needsScheduleAddressVerification, type ScheduleTruck } from '../desktop-ui/lib/schedule-contract';
import { calculateClosestTrucks, calculateDesktopRouteLegs, scheduleRoutePairs, type DesktopAppointment } from '../lib/desktop-schedule';

function appointment(id: string, start: number, end: number, patch: Partial<DesktopAppointment> = {}): DesktopAppointment {
  return { recordId: id, appointmentId: id, jkNumber: 'JK1234567', truck: 'Truck 2', hasScheduledTime: true, appointmentStartMinutes: start, appointmentEndMinutes: end, status: 'Confirmed', location: { latitude: 30, longitude: -90 }, ...patch } as DesktopAppointment;
}

async function main() {
  const jobs = [appointment('estimate-1', 480, 540, { appointmentType: 'Estimate' }), appointment('job-2', 555, 615), appointment('job-3', 600, 660), appointment('cancelled', 700, 760, { status: 'Canceled' })];
  for (const status of ['Canceled', 'Cancelled by Dispatcher']) {
    const canceled = appointment('canceled-missing-address', 550, 600, {status, location:null});
    assert.deepEqual(await calculateClosestTrucks(canceled, [], true, async()=>{throw Error('Canceled appointments must not request closest trucks');}),[]);
    assert.equal(needsScheduleAddressVerification(canceled),false,'Canceled records do not request geocoding or count as address attention');
    assert.deepEqual(scheduleRoutePairs([jobs[0],canceled,jobs[1]]).map(leg=>[leg.fromAppointmentId,leg.toAppointmentId]),[['estimate-1','job-2']],'A canceled unverified stop cannot interrupt the truck route');
  }
  const now = Date.parse('2026-09-25T22:00:00Z');
  const closest = await calculateClosestTrucks(jobs[0], [
    { truck:'Truck# 3', latitude:30.4, longitude:-91.16, lastGpsUpdate:'2026-09-25T21:35:00Z', speed:0, ignition:'OFF' },
    { truck:'Truck# 6', latitude:30.41, longitude:-91.15, lastGpsUpdate:'2026-09-25T20:44:59Z', speed:0, ignition:'OFF' },
    { truck:'Truck# 8', latitude:30.01, longitude:-90.11, lastGpsUpdate:'2026-09-25T21:59:00Z', speed:20, ignition:'ON' },
    { truck:'Truck# 9', latitude:29.99, longitude:-90.06, lastGpsUpdate:'2026-09-25T21:50:00Z', speed:0, ignition:'ON' },
  ] as ScheduleTruck[], true, async origins => {
    assert.deepEqual(origins, [
      {latitude:30.4,longitude:-91.16},
      {latitude:30.01,longitude:-90.11},
    ], 'A parked report inside its reporting window and live moving GPS are eligible; expired parked and stale non-parked reports are not');
    return [
      {originIndex:0,destinationIndex:0,condition:'ROUTE_EXISTS',duration:'3600s',distanceMeters:69201.8},
      {originIndex:1,destinationIndex:0,condition:'ROUTE_EXISTS',duration:'8400s',distanceMeters:185074.56},
    ];
  }, now);
  assert.deepEqual(closest.map(row=>[row.truck,row.status,row.minutes,row.miles]),[
    ['Truck# 3','available',60,43],
    ['Truck# 8','available',140,115],
    ['Truck# 6','stale_gps',null,null],
    ['Truck# 9','stale_gps',null,null],
  ], 'Closest truck ranking includes a valid parked observation and keeps stale reports ineligible');
  assert.equal(needsScheduleAddressVerification({...jobs[1],location:null}),true,'Active unverified work remains visible for address review');
  const pairs = scheduleRoutePairs(jobs);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].fromAppointmentId, 'estimate-1');
  assert.equal(pairs[0].toAppointmentId, 'job-2', 'Shared JK numbers must not merge distinct appointments');
  assert.equal(pairs[1].gapMinutes, -15, 'Overlapping windows must remain visible as conflicts');
  const unavailable = await calculateDesktopRouteLegs(jobs, async () => null);
  assert.ok(unavailable.every(leg => leg.travelMinutes === null && leg.miles === null && leg.source === 'unavailable'));
  let failures = 0;
  const partial = await calculateDesktopRouteLegs(jobs, async () => { if (++failures === 1) throw new Error('Provider timeout'); return [{condition:'ROUTE_EXISTS',duration:'300s',distanceMeters:1609.344}]; });
  assert.equal(partial[0].travelMinutes, null);
  assert.equal(partial[1].travelMinutes, 5, 'A failed leg must not hide other travel estimates');
  let requests = 0;
  const routed = await calculateDesktopRouteLegs(jobs, async (origins, destinations) => {
    assert.equal(origins.length * destinations.length, 1, 'Do not request or bill unused cross-pair route elements');
    requests += 1;
    return [
      { originIndex: 0, destinationIndex: 0, duration: requests === 1 ? '1200s' : '600s', distanceMeters: 16093.44, condition: 'ROUTE_EXISTS' },
      { originIndex: 0, destinationIndex: 1, duration: '1s', distanceMeters: 1, condition: 'ROUTE_EXISTS' },
    ];
  });
  assert.equal(requests, 2);
  assert.equal(routed[0].travelMinutes, 20);
  assert.equal(routed[0].miles, 10);
  assert.equal(routed[0].bufferMinutes, -5);
  assert.equal(routed[1].bufferMinutes, -25);
  const missingPin = await calculateDesktopRouteLegs([jobs[0], { ...jobs[1], location: null }], async () => { throw new Error('Unverified coordinates must not reach routing provider'); });
  assert.equal(missingPin[0].source, 'unavailable');
  const tied = [appointment('b',480,540),appointment('a',480,540,{truck:'Truck# 2'}),appointment('c',480,540),appointment('untimed',0,0,{hasScheduledTime:false,appointmentStartMinutes:null,appointmentEndMinutes:null})];
  const tiedLegs = await calculateDesktopRouteLegs(tied,async()=>[{condition:'ROUTE_EXISTS',duration:'300s',distanceMeters:1609.344}]);
  assert.deepEqual(tiedLegs.map(leg=>[leg.fromAppointmentId,leg.toAppointmentId]),[['a','b'],['b','c'],['c','untimed']]);
  assert.ok(tiedLegs.every(leg=>leg.travelMinutes===5&&leg.miles===1));
  assert.equal(tiedLegs[2].gapMinutes,null);
  assert.equal(tiedLegs[2].bufferMinutes,null);
  assert.deepEqual(scheduleRoutePairs([...tied].reverse()),scheduleRoutePairs(tied),'Same-time order must not change when source rows reorder');
  console.log('Schedule contracts passed: separate appointment identity, route ordering, overlaps, verified coordinates, parked and live closest-truck GPS, provider distance/time, and no fabricated fallback.');
}
void main();
