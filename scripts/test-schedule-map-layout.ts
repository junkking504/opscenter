import assert from 'node:assert/strict';
import { locatorSize, separateMapLocators, type LocatorPoint } from '../desktop-ui/lib/schedule-map-layout';

function check(points: LocatorPoint[], zoom: number, viewport: { x: number; y: number }) {
  const original = JSON.stringify(points);
  const size = locatorSize(zoom) + 24;
  const result = separateMapLocators(points, size, viewport);
  assert.equal(JSON.stringify(points), original, 'Source locations must not change');
  assert.equal(result.positions.size + result.overflow.length, points.length, 'Every locator remains individually visible or selectable in overflow');
  assert.deepEqual([...result.positions], [...separateMapLocators([...points].reverse(), size, viewport).positions], 'Source ordering cannot swap locator positions');
  const boxes = [...result.positions.values(), ...(result.overflow.length ? [result.overflowPoint] : [])];
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    assert(a.x >= size / 2 && a.x <= viewport.x - size / 2 && a.y >= size / 2 && a.y <= viewport.y - size / 2, 'Targets stay inside the map');
    for (const b of boxes.slice(i + 1)) assert(Math.abs(a.x - b.x) >= size + 4 || Math.abs(a.y - b.y) >= size + 4, 'Click targets and their focus rings must not overlap');
  }
  return result;
}

for (const zoom of [8, 12, 13, 15, 16, 20]) {
  const points = Array.from({ length: 9 }, (_, i) => ({ id: i ? `truck:${i}` : 'appointment:onsite', x: 180, y: 120 }));
  assert.equal(check(points, zoom, { x: 720, y: 400 }).overflow.length, 0, 'An appointment and eight trucks at one site must each be visible');
  check(points, zoom, { x: 320, y: 240 });
  check(points.map((point, i) => ({ ...point, x: i % 2 ? 1 : 318, y: i % 3 ? 1 : 238 })), zoom, { x: 320, y: 240 });
}
const separated = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 400, y: 200 }];
assert.deepEqual([...check(separated, 16, { x: 720, y: 400 }).positions.values()], separated.map(({ x, y }) => ({ x, y })), 'Isolated icons remain on their source point');
const crowded = Array.from({ length: 60 }, (_, i) => ({ id: `appointment:${i}`, x: 160, y: 100 }));
assert(check(crowded, 16, { x: 320, y: 200 }).overflow.length > 0, 'Dense maps provide a selectable count instead of hidden or overlapping locators');
assert.equal(check([], 12, { x: 720, y: 400 }).positions.size, 0);
console.log('Map locator layout passed: zoom levels, co-located appointments/trucks, edges, stable identity, exact source points, dense overflow and non-overlapping targets.');
