import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /const jobClusters = clusterVisibleMapItems\(map, locatedJobs, \(job\) => job, 44\)[\s\S]*?if \(cluster\.items\.length > 1\)[\s\S]*?appointmentClusterIcon[\s\S]*?addInteractiveMarker\(marker, \(\) => focusMapArea\(cluster\.items\)\);/,
  "Nearby appointments must collapse into a count that focuses the map without opening one appointment.",
);
assert.match(source, /function clusterTerritoryTone\(jobs: JobsMapPoint\[\]\): string/);
assert.match(source, /function appointmentClusterIcon\(leaflet: LeafletModule, count: number, tone: string\)/);
assert.doesNotMatch(source, /spreadLocatedJobMarkers/);
assert.match(source, /function spreadLiveTruckMarkers\(map: any, trucks: JobsMapTruck\[\]\): VisibleTruckMarker\[\]/);
assert.match(source, /const truckMarkers = spreadLiveTruckMarkers\(map, liveTruckLocations\);/);
assert.doesNotMatch(source, /truck\.status === "At Job" && distanceMeters\(truck, job\)/, "On-site markers require current GPS dwell, not a historical status label.");
assert.match(source, /const TRUCK_MARKER_PANE = "ops-truck-marker-pane"/);
assert.match(source, /iconSize: \[20, 24\]/, "Appointment locator footprint must remain compact.");
assert.match(source, /iconSize: \[30, 20\]/, "Truck locator footprint must remain compact.");
assert.match(source, /map\.createPane\(TRUCK_MARKER_PANE\)/);
assert.match(source, /truckMarkerPane\.style\.zIndex = "675"/);
assert.match(
  source,
  /for \(const \{ truck, latitude, longitude \} of truckMarkers\) \{[\s\S]*?leaflet\.marker\(\[latitude, longitude\][\s\S]*?icon: truckIcon\(leaflet, truck, truck\.truck === selectedTruckName, atJob\)[\s\S]*?pane: TRUCK_MARKER_PANE/,
  "Every live truck must render as its own truck icon.",
);
assert.match(source, /zIndexOffset: truck\.truck === selectedTruckName \? 1500 : 1400/);
assert.doesNotMatch(source, /locationClusterIcon/);
assert.doesNotMatch(source, /map items at this location/);
assert.doesNotMatch(source, /truckClusterIcon/);
assert.doesNotMatch(source, /truckClusters = clusterVisibleMapItems/);
console.log("Dispatch appointments cluster cleanly while truck locators remain individual.");
