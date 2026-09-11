import assert from 'node:assert/strict';
import fs from 'node:fs';
import { locatorSize } from '../desktop-ui/lib/schedule-map-layout';

assert.equal(locatorSize(8), 10, 'Overview locators stay small');
assert.equal(locatorSize(18), 36, 'Street-level locators stay readable');
for (let zoom = 10; zoom < 17; zoom++) assert(locatorSize(zoom + 1) > locatorSize(zoom), 'Both locator types grow with zoom');
const map = fs.readFileSync('desktop-ui/schedule-map.tsx', 'utf8');
assert.match(map, /for \(const \{ pin \} of visiblePins\)/, 'Render each appointment and truck separately');
assert.match(map, /L\.marker\(pin\.coordinate/, 'Each icon must retain its own exact source coordinate');
assert.match(map, /iconAnchor: \[iconSize\[0\] \/ 2, iconSize\[1\] \/ 2\]/, 'The visible icon must stay centered on that coordinate');
assert.doesNotMatch(map, /groupMapLocators|separateMapLocators|map-locator-(?:count|overflow|connector|origin)|choicesForGroup|containerPointToLatLng/, 'Do not shift icons, group locations, add counters or draw locator leaders');
console.log('Individual map locators passed: zoom sizing, exact centered anchors, one locator per source, no offsets, groups, counters or leader lines.');
