import assert from 'node:assert/strict';
import { centeredExtent } from '../desktop-ui/lib/truck-map-viewport';

const center = { x: 120, y: 80 };
// A loop goes much farther north and east than either trip endpoint.
const points = [center, { x: 150, y: 75 }, { x: 205, y: 10 }, { x: 115, y: 85 }];
const extent = centeredExtent(center, points);
assert.equal((extent.min.x + extent.max.x) / 2, center.x);
assert.equal((extent.min.y + extent.max.y) / 2, center.y);
for (const point of points) {
  assert(point.x >= extent.min.x && point.x <= extent.max.x);
  assert(point.y >= extent.min.y && point.y <= extent.max.y);
}
assert.deepEqual(centeredExtent(center, []), { min: center, max: center });
assert.deepEqual(centeredExtent(center, [center]), { min: center, max: center });
console.log('Truck viewport: centered GPS, complete loop extent, empty and stationary routes passed.');
