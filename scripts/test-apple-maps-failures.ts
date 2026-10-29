import assert from 'node:assert/strict';
import { appleMapEngine, loadAppleMapKit, type MapKit } from '../desktop-ui/lib/apple-mapkit';

// Exercise authorization timing without loading Apple or counting map views.
let constructions = 0;
let destroyed = 0;
let appended = 0;
class FakeMap extends EventTarget {
  colorScheme = 'light';
  constructor() { super(); constructions++; }
  destroy() { destroyed++; }
}
function kit() {
  return Object.assign(new EventTarget(), { Map: FakeMap, Annotation: class {} }) as unknown as MapKit;
}
const earlyKit = kit();
const win = { mapkit: earlyKit, setTimeout, opscenterMapKitReady: undefined as undefined | (() => void) };
Object.assign(globalThis, {
  window: win,
  document: {
    documentElement: { dataset: {} },
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { append() { appended++; queueMicrotask(() => win.opscenterMapKitReady?.()); } },
  },
  MutationObserver: class { observe() {} disconnect() {} },
});
async function main() {
const loaded = await loadAppleMapKit('synthetic-token');
assert.equal(loaded, earlyKit);
// Error arrives after SDK readiness, before React creates a View.
earlyKit.dispatchEvent(new Event('error'));
const host = { prepend() {} } as unknown as HTMLElement;
assert.throws(() => appleMapEngine(earlyKit, () => {}).map(host, { zoomControl: true, scrollWheelZoom: true }), /unavailable/);
await assert.rejects(loadAppleMapKit('synthetic-token'), /unavailable/);
assert.equal(constructions, 0, 'Early authorization failure must not create a map');
assert.equal(appended, 1, 'Remount must not load another SDK');

const runningKit = kit();
let fallbacks = 0;
const engine = appleMapEngine(runningKit, () => { fallbacks++; });
const view = engine.map(host, { zoomControl: true, scrollWheelZoom: true });
assert.equal(constructions, 1);
runningKit.dispatchEvent(new Event('error'));
assert.equal(fallbacks, 1, 'A mounted view must trigger fallback');
view.remove();
assert.equal(destroyed, 1);
assert.throws(() => engine.map(host, { zoomControl: true, scrollWheelZoom: true }), /unavailable/);
assert.equal(constructions, 1, 'Runtime error must prevent another counted map on remount');
runningKit.dispatchEvent(new Event('error'));
assert.equal(fallbacks, 1, 'Removed view must detach its failure callback');
console.log('Apple failures: early authorization, runtime fallback, no retry on remount, listener teardown PASS.');

}
main().catch(error => { console.error(error); process.exitCode = 1; });
