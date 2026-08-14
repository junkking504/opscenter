import assert from "node:assert/strict";
import { buildJobRouteHistory } from "../lib/job-route-history";

const points = Array.from({ length: 10 }, (_, index) => ({
  timestamp: `2026-08-14T${String(8 + index).padStart(2, "0")}:00:00Z`,
  latitude: 30 + index / 100,
  longitude: -90 - index / 100,
}));

const segments = buildJobRouteHistory(points, [
  { label: "JK-101", latitude: 30.02, longitude: -90.02, begin: "2026-08-14T10:00:00Z", end: "2026-08-14T11:00:00Z" },
  { label: "JK-202", latitude: 30.05, longitude: -90.05, begin: "2026-08-14T13:00:00Z", end: "2026-08-14T14:00:00Z" },
]);

assert.deepEqual(segments.map((segment) => segment.label), ["To JK-101", "To JK-202", "After JK-202"]);
assert.deepEqual(segments.map((segment) => segment.kind), ["job", "job", "current"]);
assert.equal(segments[0].points.at(-1)?.timestamp, "2026-08-14T10:00:00Z");
assert.equal(segments[1].points[0]?.timestamp, "2026-08-14T11:00:00Z");
assert.equal(segments[1].points.at(-1)?.timestamp, "2026-08-14T13:00:00Z");
assert.equal(segments[2].points[0]?.timestamp, "2026-08-14T14:00:00Z");
assert.notEqual(segments[0].color, segments[1].color);

assert.deepEqual(buildJobRouteHistory(points, []), [{
  key: "current-2026-08-14T08:00:00Z",
  label: "Today’s route",
  color: "#cbd5e1",
  kind: "current",
  points,
  stop: null,
}]);

console.log("Appointment map job-route history checks passed.");
