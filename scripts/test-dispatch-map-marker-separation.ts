import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");

assert.match(source, /function appointmentClusterArea\(job: JobsMapPoint\): string/);
assert.match(source, /territory === "new orleans" \|\| territory === "jefferson parish"/);
assert.match(source, /const jobsByClusterArea = new Map<string, Array<JobsMapPoint & \{ latitude: number; longitude: number \}>>\(\)/);
assert.match(source, /clusterVisibleMapItems\(map, areaJobs, \(job\) => job, 44\)/);
assert.match(source, /const truckClusters = clusterVisibleMapItems\(map, liveTruckLocations/);
assert.match(source, /title: `\$\{cluster\.items\.length\} appointments in this area`/);
assert.match(source, /title: `\$\{cluster\.items\.length\} trucks in this area`/);
assert.doesNotMatch(source, /locationClusterIcon/);
assert.doesNotMatch(source, /map items at this location/);
console.log("Dispatch truck and appointment markers are separated.");
