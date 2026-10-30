import assert from 'node:assert/strict';
import { appleMapsCsp } from '../lib/apple-maps-csp';
assert.deepEqual(appleMapsCsp(false), {script:'',image:'',connect:'',directives:[]});
const enabled = appleMapsCsp(true);
assert.equal(enabled.script,'https://cdn.apple-mapkit.com');
assert.equal(enabled.connect,'https://*.apple-mapkit.com');
assert.equal(enabled.image,enabled.connect);
assert(enabled.directives.includes("worker-src 'self' blob: https://*.apple-mapkit.com"));
assert(enabled.directives.includes("frame-src 'self' https://*.apple-mapkit.com"));
for (const value of [enabled.script,enabled.image,enabled.connect,...enabled.directives]) {
  assert(!value.includes('https: '), 'Do not permit all HTTPS sources');
  assert(!value.includes('*.apple.com'), 'Limit scope to MapKit hosts');
}
console.log('Apple CSP sources: disabled policy preserved, enabled sources limited to MapKit CDN.');
