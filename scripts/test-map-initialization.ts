import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const file of ["components/JobsMap.tsx", "components/FleetMap.tsx"]) {
  const source = readFileSync(file, "utf8");
  assert.match(source, /\.setView\(LOUISIANA_MAP_CENTER, LOUISIANA_MAP_ZOOM\)/, `${file} must initialize a valid fallback viewport before positioning markers.`);
}

console.log("Dispatch and Fleet map initialization checks passed.");
