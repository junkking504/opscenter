import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");
const markerRendering = source.slice(source.indexOf("markers.clearLayers()"));

assert.match(
  source,
  /const locatedJobsRef = useRef\(locatedJobs\);[\s\S]*?locatedJobsRef\.current = locatedJobs;/,
  "Default framing must retain the current verified job locations without rebuilding the map on live GPS refreshes.",
);
assert.match(
  source,
  /const jobPoints = locatedJobsRef\.current\.map\(\(job\) => \[job\.latitude, job\.longitude\] as \[number, number\]\);[\s\S]*?map\.fitBounds\(jobPoints, \{[\s\S]*?maxZoom: ALL_JOBS_MAP_MAX_ZOOM/,
  "Default and Escape framing must fit the verified job markers instead of a fixed wide service box.",
);
assert.match(
  source,
  /if \(!map \|\| !focusSelectedTruck \|\| !selectedTruck\) return;[\s\S]*?setFocusSelectedTruck\(false\);/,
  "A schedule-board truck focus must be consumed after its initial map center.",
);
assert.match(
  source,
  /const selectMapTruck = useCallback\([\s\S]*?setFocusSelectedTruck\(true\);[\s\S]*?map\.setView\(\[selectedTruck\.latitude, selectedTruck\.longitude\], Math\.max\(map\.getZoom\(\), 14\), \{ animate: true \}\);/,
  "Truck icons and truck-block rows must focus the truck's current GPS location, not its route extent.",
);
assert.doesNotMatch(
  markerRendering,
  /focusSelectedTruck[\s\S]*?(?:fitBounds|setView)/,
  "Marker redraws caused by zoom must not recenter the map.",
);

console.log("Dispatch manual map zoom persists after marker redraws.");
