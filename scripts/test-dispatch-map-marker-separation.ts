import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /function spreadLocatedJobMarkers[\s\S]*?clusterVisibleMapItems\(map, jobs, \(job\) => job, 22\)[\s\S]*?for \(const \{ job, latitude, longitude \} of jobMarkers\) \{[\s\S]*?leaflet\.marker\(\[latitude, longitude\][\s\S]*?addInteractiveMarker\(marker, \(\) => selectMapJob\(job\)\);/,
  "Every verified appointment must render as and focus from its own marker.",
);
assert.doesNotMatch(source, /jobsByClusterArea|jobClusters|appointmentClusterArea|appointmentClusterIcon/);
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
console.log("Dispatch truck and appointment markers are separated.");
