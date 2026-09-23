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
assert.match(map, /className="truck-map-view-controls"/, 'Selected trucks expose grouped map view controls');
assert.match(map, /View Routes/, 'Selected trucks expose the requested View Routes action');
assert.match(map, /onSelectTrip\?\.\(null\)/, 'View Routes selects the complete day route instead of one trip');
assert.match(map, /aria-pressed=\{viewingRoutes\}/, 'The route control exposes its active state');
const telemetryCss = fs.readFileSync('desktop-ui/truck-telemetry.css', 'utf8');
assert.match(telemetryCss, /\.truck-map-view-controls \{[^}]*display: flex/, 'Following and View Routes stay beside each other when space allows');
console.log('Schedule map passed: exact centered locators and a selected-truck View Routes control for the complete day route.');
