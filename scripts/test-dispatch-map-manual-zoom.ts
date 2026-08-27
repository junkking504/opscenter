import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");
const markerRendering = source.slice(source.indexOf("markers.clearLayers()"));

assert.match(
  source,
  /if \(!map \|\| !focusSelectedTruck \|\| !selectedTruck\) return;[\s\S]*?setFocusSelectedTruck\(false\);/,
  "A schedule-board truck focus must be consumed after its initial map center.",
);
assert.doesNotMatch(
  markerRendering,
  /focusSelectedTruck[\s\S]*?(?:fitBounds|setView)/,
  "Marker redraws caused by zoom must not recenter the map.",
);

console.log("Dispatch manual map zoom persists after marker redraws.");
