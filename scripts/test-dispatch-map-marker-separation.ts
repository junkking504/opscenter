import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /const jobClusters = clusterVisibleMapItems\(map, locatedJobs, \(job\) => job, 44\)[\s\S]*?if \(cluster\.items\.length > 1\)[\s\S]*?appointmentClusterIcon[\s\S]*?addInteractiveMarker\(marker, \(\) => focusMapArea\(cluster\.items\)\);/,
  "Nearby appointments must collapse into a count that focuses the map without opening one appointment.",
);
assert.match(source, /function clusterTerritoryTone\(jobs: JobsMapPoint\[\]\): string/);
assert.match(source, /function appointmentClusterIcon\(leaflet: LeafletModule, jobs: JobsMapPoint\[\], tone: string\)/);
assert.match(
  source,
  /const canceledCount = jobs\.filter\(\(job\) => job\.statusBucket === "Canceled"\)\.length;[\s\S]*?is-all-canceled[\s\S]*?has-canceled[\s\S]*?&times;\$\{canceledCount\}/,
  "Appointment clusters must expose how many nearby appointments are cancelled.",
);
assert.match(
  source,
  /const canceled = job\.statusBucket === "Canceled";[\s\S]*?ops-jobs-map-pin-cancel[\s\S]*?&times;/,
  "A cancelled appointment must render an explicit cross instead of an empty scheduled-job pin.",
);
assert.match(source, /const cancellationPrefix = job\.statusBucket === "Canceled" \? "CANCELLED · " : "";/);
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

const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const usabilityCss = readFileSync(new URL("../app/ops-usability.css", import.meta.url), "utf8");
assert.match(
  globalCss,
  /\.ops-jobs-map-pin\.is-canceled \{[\s\S]*?border-radius: 3px;[\s\S]*?repeating-linear-gradient[\s\S]*?opacity: 1;/,
  "Cancelled map pins must use the high-contrast caution diamond, not a dimmed scheduled pin.",
);
assert.match(globalCss, /\.ops-jobs-map-pin \.ops-jobs-map-pin-cancel \{/);
assert.match(usabilityCss, /\.ops-map-cluster\.is-appointments\.has-canceled,[\s\S]*?\.ops-map-cluster\.is-appointments\.is-all-canceled/);
console.log("Dispatch appointments cluster cleanly while truck locators remain individual.");
