import assert from 'node:assert/strict';
import { calculateDesktopRouteLegs, scheduleRoutePairs, type DesktopAppointment } from '../lib/desktop-schedule';

function appointment(id: string, start: number, end: number, patch: Partial<DesktopAppointment> = {}): DesktopAppointment {
  return { recordId: id, appointmentId: id, jkNumber: 'JK1234567', truck: 'Truck 2', hasScheduledTime: true, appointmentStartMinutes: start, appointmentEndMinutes: end, status: 'Confirmed', location: { latitude: 30, longitude: -90 }, ...patch } as DesktopAppointment;
}

async function main() {
  const jobs = [appointment('estimate-1', 480, 540, { appointmentType: 'Estimate' }), appointment('job-2', 555, 615), appointment('job-3', 600, 660), appointment('cancelled', 700, 760, { status: 'Canceled' })];
  const pairs = scheduleRoutePairs(jobs);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].fromAppointmentId, 'estimate-1');
  assert.equal(pairs[0].toAppointmentId, 'job-2', 'Shared JK numbers must not merge distinct appointments');
  assert.equal(pairs[1].gapMinutes, -15, 'Overlapping windows must remain visible as conflicts');
  const unavailable = await calculateDesktopRouteLegs(jobs, async () => null);
  assert.ok(unavailable.every(leg => leg.travelMinutes === null && leg.miles === null && leg.source === 'unavailable'));
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
  console.log('Schedule contracts passed: separate appointment identity, route ordering, overlaps, verified coordinates, provider distance/time, and no fabricated fallback.');
}
void main();
