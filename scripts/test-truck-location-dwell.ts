import assert from "node:assert/strict";

import { currentTruckLocationDwell, type JobsMapTruck } from "@/components/JobsMap";

const now = Date.parse("2026-08-18T18:30:00Z");

function truck(overrides: Partial<JobsMapTruck> = {}): JobsMapTruck {
  return {
    truck: "Truck 6",
    latitude: 29.9500,
    longitude: -90.0700,
    status: "At Job",
    freshness: "Live GPS",
    lastGpsUpdate: "2026-08-18T18:29:00Z",
    driver: "Driver",
    navigator: "Navigator",
    recentPoints: [
      { timestamp: "2026-08-18T18:20:00Z", latitude: 29.9500, longitude: -90.0700 },
      { timestamp: "2026-08-18T18:29:00Z", latitude: 29.9501, longitude: -90.0701 },
    ],
    routePoints: [],
    jobStops: [],
    recentStops: [],
    ...overrides,
  };
}

const jobSite = currentTruckLocationDwell(truck({
  jobStops: [{
    label: "JK-123",
    latitude: 29.9500,
    longitude: -90.0700,
    begin: "2026-08-18T18:10:00Z",
    end: "",
  }],
}), now);
assert.deepEqual(jobSite, {
  kind: "job_site",
  beganAt: "2026-08-18T18:10:00.000Z",
  elapsedMs: 20 * 60_000,
});

const regularStop = currentTruckLocationDwell(truck({
  status: "Idle",
  recentStops: [{
    latitude: 29.9500,
    longitude: -90.0700,
    begin: "2026-08-18T18:12:00Z",
    end: "2026-08-18T18:29:00Z",
  }],
}), now);
assert.equal(regularStop?.kind, "location");
assert.equal(regularStop?.elapsedMs, 18 * 60_000);

assert.equal(currentTruckLocationDwell(truck({
  recentPoints: [{ timestamp: "2026-08-18T18:27:00Z", latitude: 29.9500, longitude: -90.0700 }],
}), now), null, "under-five-minute dwells stay hidden");

assert.equal(currentTruckLocationDwell(truck({
  lastGpsUpdate: "2026-08-18T18:19:00Z",
}), now), null, "stale GPS must not claim the truck is still there");

assert.equal(currentTruckLocationDwell(truck({
  status: "Driving",
}), now), null, "a driving truck must not be described as sitting");

console.log("Truck location dwell checks passed.");
