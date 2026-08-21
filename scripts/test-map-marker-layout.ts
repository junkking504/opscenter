import assert from "node:assert/strict";
import { mapMarkerCollisionOffsets } from "../lib/map-marker-layout";

type Marker = { key: string; x: number; y: number };
const layout = (records: Marker[]) => mapMarkerCollisionOffsets(
  records,
  (record) => record.key,
  (record) => record,
);

const solitary = layout([{ key: "job:1", x: 100, y: 100 }]);
assert.deepEqual(solitary.get("job:1"), { x: 0, y: 0 });

const stacked = layout([
  { key: "job:1", x: 100, y: 100 },
  { key: "truck:2", x: 100, y: 100 },
]);
assert.notDeepEqual(stacked.get("job:1"), stacked.get("truck:2"));
assert.equal(Math.abs((stacked.get("job:1")?.x || 0) - (stacked.get("truck:2")?.x || 0)), 58);

const crowded = layout(Array.from({ length: 8 }, (_, index) => ({
  key: index % 2 ? `truck:${index}` : `job:${index}`,
  x: 240,
  y: 180,
})));
const targets = Array.from(crowded.values()).map((offset) => `${offset.x},${offset.y}`);
assert.equal(new Set(targets).size, 8, "every stacked marker receives a unique visible target");

const bridged = layout([
  { key: "job:a", x: 0, y: 0 },
  { key: "job:b", x: 50, y: 0 },
  { key: "truck:c", x: 100, y: 0 },
]);
assert.equal(new Set(Array.from(bridged.values()).map((offset) => `${offset.x},${offset.y}`)).size, 3);

console.log("Map marker collision layout tests passed.");
