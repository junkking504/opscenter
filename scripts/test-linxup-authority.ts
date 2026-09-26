import { strict as assert } from "node:assert";
import {
  isLinxupV3Position,
  selectAuthoritativeLinxupPoint,
  summarizeLinxupV3Stream,
} from "../lib/linxup-authority";

const now = Date.parse("2026-08-31T17:00:00Z");
const v2 = {
  timestamp: "2026-08-31T16:59:50Z",
  source_record_id: "v2-position",
  delivery_source: "v2_poll",
};
const freshV3 = {
  timestamp: "2026-08-31T16:59:30Z",
  source_record_id: "v3-position-123",
  delivery_source: "v3_position_push",
};
const staleV3 = {
  ...freshV3,
  timestamp: "2026-08-31T16:50:00Z",
};

assert.equal(isLinxupV3Position(freshV3), true);
assert.equal(isLinxupV3Position({ source_record_id: "v3-position-legacy" }), true);
assert.equal(isLinxupV3Position(v2), false);

assert.deepEqual(selectAuthoritativeLinxupPoint([v2, freshV3], now), {
  point: freshV3,
  mode: "v3_position_push",
  fallbackActive: false,
  latestV3PositionAt: freshV3.timestamp,
});

assert.deepEqual(selectAuthoritativeLinxupPoint([v2, staleV3], now), {
  point: v2,
  mode: "v2_poll_fallback",
  fallbackActive: true,
  latestV3PositionAt: staleV3.timestamp,
});

const olderV2 = { ...v2, timestamp: "2026-08-31T16:40:00Z" };
assert.deepEqual(selectAuthoritativeLinxupPoint([olderV2, staleV3], now), {
  point: staleV3,
  mode: "last_known",
  fallbackActive: false,
  latestV3PositionAt: staleV3.timestamp,
});

assert.deepEqual(selectAuthoritativeLinxupPoint([staleV3], now), {
  point: staleV3,
  mode: "last_known",
  fallbackActive: false,
  latestV3PositionAt: staleV3.timestamp,
});

assert.equal(selectAuthoritativeLinxupPoint([{...freshV3,timestamp:'invalid'},v2],now).point,v2);
assert.equal(selectAuthoritativeLinxupPoint([{...freshV3,timestamp:'2026-08-31T18:00:00Z'},v2],now).point,v2);
assert.equal(selectAuthoritativeLinxupPoint([olderV2,staleV3].reverse(),now).point,staleV3);

assert.deepEqual(selectAuthoritativeLinxupPoint([], now), {
  point: null,
  mode: "unavailable",
  fallbackActive: false,
  latestV3PositionAt: null,
});

console.log("LinxUp V3 authority checks passed.");

const sameTimePoll = {...v2, timestamp:'2026-08-31T16:50:00.000Z'};
for (const points of [[sameTimePoll, staleV3],[staleV3, sameTimePoll]]) {
  assert.equal(selectAuthoritativeLinxupPoint(points,now).point,staleV3,'Equal-time parked observations keep V3 ignition after live authority expires.');
}

const truck2Stopped = {
  ...staleV3,
  tracker_id: "truck-2",
  timestamp: "2026-08-31T16:50:00Z",
  ignition_state: "OFF",
};
const truck8Stopped = {
  ...staleV3,
  tracker_id: "truck-8",
  timestamp: "2026-08-31T16:51:00Z",
  ignition_state: "OFF",
};
const truck8ParkedPoll = {
  ...v2,
  tracker_id: "truck-8",
  timestamp: "2026-08-31T16:59:00Z",
  latitude: 29.98643,
  longitude: -90.058503,
  speed: 0,
};
const truck8StoppedAtWarehouse = {
  ...truck8Stopped,
  latitude: 29.98643,
  longitude: -90.058503,
};
assert.deepEqual(summarizeLinxupV3Stream([truck2Stopped, truck8StoppedAtWarehouse, truck8ParkedPoll], now), {
  latestPositionAt: truck8Stopped.timestamp,
  fresh: false,
  expectedSilent: true,
});

const truck8Running = {
  ...truck8Stopped,
  timestamp: "2026-08-31T16:52:00Z",
  ignition_state: "ON",
};
assert.deepEqual(summarizeLinxupV3Stream([truck2Stopped, truck8Stopped, truck8Running], now), {
  latestPositionAt: truck8Running.timestamp,
  fresh: false,
  expectedSilent: false,
});

assert.deepEqual(summarizeLinxupV3Stream([{
  ...truck8Running,
  timestamp: "2026-08-31T16:59:30Z",
}], now), {
  latestPositionAt: "2026-08-31T16:59:30Z",
  fresh: true,
  expectedSilent: false,
});

assert.equal(summarizeLinxupV3Stream([
  truck2Stopped,
  truck8StoppedAtWarehouse,
  { ...truck8ParkedPoll, speed: 12 },
], now).expectedSilent, false, "Newer V2 movement must expose a missed V3 stream.");

assert.equal(summarizeLinxupV3Stream([
  truck2Stopped,
  truck8StoppedAtWarehouse,
  { ...truck8ParkedPoll, latitude: 29.99 },
], now).expectedSilent, false, "A newer materially different V2 location must expose a missed V3 stream.");
