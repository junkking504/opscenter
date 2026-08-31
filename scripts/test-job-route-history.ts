import assert from "node:assert/strict";
import { buildJobRouteHistory, splitPlausibleRouteRuns } from "../lib/job-route-history";

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
  paths: [points],
  stop: null,
}]);

const truck9Jump = [
  { timestamp: "2026-08-25T15:41:26Z", latitude: 30.43522, longitude: -90.04281 },
  { timestamp: "2026-08-25T15:41:31Z", latitude: 30.43522, longitude: -90.04281 },
  { timestamp: "2026-08-25T15:43:29Z", latitude: 30.01443, longitude: -90.154462 },
  { timestamp: "2026-08-25T15:43:29Z", latitude: 30.4352, longitude: -90.0428 },
  { timestamp: "2026-08-25T15:43:29Z", latitude: 30.0144, longitude: -90.1545 },
  { timestamp: "2026-08-25T15:44:30Z", latitude: 30.014404, longitude: -90.154464 },
];

assert.deepEqual(
  splitPlausibleRouteRuns(truck9Jump).map((run) => run.length),
  [2, 1, 1, 2],
  "Truck 9's impossible 29.8-mile jump and duplicate endpoint bounce must split the displayed trail",
);

const plausibleGap = [
  { timestamp: "2026-08-25T21:38:14Z", latitude: 30.378047, longitude: -89.97 },
  { timestamp: "2026-08-25T22:05:05Z", latitude: 30.124567, longitude: -89.880151 },
];
assert.equal(
  splitPlausibleRouteRuns(plausibleGap).length,
  1,
  "A plausible 27-minute highway movement must remain connected",
);

const jumpHistory = buildJobRouteHistory(truck9Jump, []);
assert.deepEqual(jumpHistory[0]?.paths.map((path) => path.length), [2, 2]);

console.log("Appointment map job-route history checks passed.");
