import assert from 'node:assert/strict';
import { truckMapOrientation } from '../desktop-ui/lib/truck-map-icon';

for (const [heading, expected] of [['N',0],['NE',45],['E',90],['SE',135],['S',180],['SW',225],['W',270],['NW',315],['NNW',337.5],[' e ',90],[0,0],['0',0],['360°',0],['247.5',247.5]] as const) {
  const result = truckMapOrientation(heading)!;
  assert.equal(result.bearing, expected);
  // The transformed front of the cab must point at the provider bearing.
  const cabAngle = result.rotation + (result.mirrored ? 180 : 0);
  assert.ok(Math.abs(Math.cos(cabAngle*Math.PI/180)-Math.sin(expected*Math.PI/180)) < 1e-10);
  assert.ok(Math.abs(Math.sin(cabAngle*Math.PI/180)+Math.cos(expected*Math.PI/180)) < 1e-10);
}
for (const heading of [null, undefined, '', ' ', 'unknown', 'N/A', -1, 361, NaN, Infinity, '90junk']) assert.equal(truckMapOrientation(heading), null);
assert.equal(truckMapOrientation('W')!.mirrored, true);
assert.equal(truckMapOrientation('E')!.mirrored, false);
console.log('Truck heading: compass and numeric bearings, north zero, cab direction and unavailable values passed.');
