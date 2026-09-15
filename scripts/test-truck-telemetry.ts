import assert from 'node:assert/strict';
import { truckTelemetry } from '../desktop-ui/lib/truck-telemetry';

const now = Date.parse('2026-09-15T13:00:00Z');
const observation = (speed: number | null, age: number) => ({ speed, lastGpsUpdate: new Date(now - age).toISOString() });
assert.equal(truckTelemetry(observation(43, 61_000), now).markerLabel, '43 mph');
assert.equal(truckTelemetry(observation(0, 0), now).speed, '0 mph');
assert.equal(truckTelemetry(observation(43, 61_000), now).reportAge, '1m 1s ago');
assert.equal(truckTelemetry(observation(43, 180_000), now).recent, true);
assert.equal(truckTelemetry(observation(43, 181_000), now).markerLabel, 'Last 43 mph');
assert.equal(truckTelemetry(observation(0, 3600_000), now).recent, false, 'Parked heartbeat is not current speed.');
for (const speed of [null, -1, NaN, Infinity]) assert.equal(truckTelemetry(observation(speed, 0), now).speed, 'Unavailable');
assert.equal(truckTelemetry(observation(40, -1000), now).speed, 'Unavailable');
assert.equal(truckTelemetry({speed:40,lastGpsUpdate:'invalid'}, now).speed, 'Unavailable');
assert.equal(truckTelemetry(undefined, now).recent, false);
console.log('Truck telemetry: mph, zero, age, stale, parked, missing and invalid reports passed.');
