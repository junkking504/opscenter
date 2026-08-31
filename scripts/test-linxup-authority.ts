import { strict as assert } from "node:assert";
import {
  isLinxupV3Position,
  selectAuthoritativeLinxupPoint,
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

assert.deepEqual(selectAuthoritativeLinxupPoint([], now), {
  point: null,
  mode: "unavailable",
  fallbackActive: false,
  latestV3PositionAt: null,
});

console.log("LinxUp V3 authority checks passed.");
