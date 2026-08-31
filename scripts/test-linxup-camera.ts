import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTruckNumberFromLabel, truckCameraLabel } from "../lib/linxup-truck-label";

const accepted = new Map<string, number>([
  ["T1", 1],
  ["t09", 9],
  ["Truck 2", 2],
  ["Truck #8", 8],
  ["  Truck   4  ", 4],
]);

for (const [label, expected] of accepted) {
  assert.equal(parseTruckNumberFromLabel(label), expected, label);
}

for (const label of ["Truck", "Truck at job", "T", "Route T2", "Truck 2 mileage", "0", "T0", "Truck 100"]) {
  assert.equal(parseTruckNumberFromLabel(label), null, label);
}

assert.equal(truckCameraLabel(9), "Truck 9");

const cameraControllerSource = readFileSync(new URL("../components/TruckCameraController.tsx", import.meta.url), "utf8");
const jobsMapSource = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");

assert.match(cameraControllerSource, /closest<HTMLElement>\("\[data-truck-camera\]"\)/);
assert.doesNotMatch(cameraControllerSource, /parseTruckNumberFromLabel|candidate\.textContent/);
assert.match(jobsMapSource, /data-truck-camera=\{selectedTruckCameraNumber\}/);
assert.match(jobsMapSource, />\s*View live video\s*</);
assert.match(jobsMapSource, /<article className="ops-jobs-map-selection ops-jobs-map-truck-selection is-truck"/);
console.log("LinxUp camera label tests passed.");
