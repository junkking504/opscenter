import assert from 'node:assert/strict';
import {startAppleMap} from '../app/crew-jobs/apple-map-session';

class FakeObserver { static live = 0; constructor(public cb: () => void) {} observe() { FakeObserver.live++; } disconnect() { FakeObserver.live--; } }
(globalThis as unknown as {ResizeObserver: typeof FakeObserver}).ResizeObserver = FakeObserver;

const stop = (id: string, lat: number, lon: number) => ({id, label: id, customerName: id, truck: 'Truck 1', status: 'Confirmed', address: '', location: {latitude: lat, longitude: lon, approximate: false}}) as never;
const located = [stop('1', 30, -90), stop('2', 30.1, -90.1)];

function fake(options: {regionThrows?: boolean; removeThrows?: boolean; annotationThrows?: boolean} = {}) {
  const metrics = {created: 0, destroyed: 0, removed: 0, listeners: 0, annotations: 0};
  class Coordinate { constructor(public latitude: number, public longitude: number) {} }
  class FakeMap {
    constructor() { metrics.created++; }
    set region(_value: unknown) { if (options.regionThrows) throw new Error('region'); }
    addAnnotation() { metrics.annotations++; }
    removeAnnotation() { if (options.removeThrows) throw new Error('remove'); metrics.removed++; }
    destroy() { metrics.destroyed++; }
  }
  const target = new EventTarget();
  const kit = {
    Coordinate, CoordinateSpan: class { constructor(public a: number, public b: number) {} }, CoordinateRegion: class { constructor(public c: unknown, public s: unknown) {} },
    Map: FakeMap,
    Annotation: class { constructor() { if (options.annotationThrows) throw new Error('annotation'); } },
    addEventListener: (...args: Parameters<EventTarget['addEventListener']>) => { metrics.listeners++; target.addEventListener(...args); },
    removeEventListener: (...args: Parameters<EventTarget['removeEventListener']>) => { metrics.listeners--; target.removeEventListener(...args); },
  } as never;
  return {kit, metrics};
}
const run = (options?: Parameters<typeof fake>[0]) => {
  const {kit, metrics} = fake(options);
  let failures = 0;
  FakeObserver.live = 0;
  const cleanup = startAppleMap(kit, {} as HTMLElement, located, {makeElement: () => ({}) as HTMLElement, onFailure: () => { failures++; }});
  return {cleanup, metrics, failures: () => failures};
};

// Normal path: one map, both pins, torn down once by cleanup.
let r = run();
assert.equal(r.metrics.created, 1); assert.equal(r.metrics.annotations, 2); assert.equal(r.failures(), 0); assert.equal(FakeObserver.live, 1);
r.cleanup(); r.cleanup();
assert.equal(r.metrics.destroyed, 1); assert.equal(r.metrics.removed, 2); assert.equal(r.metrics.listeners, 0); assert.equal(FakeObserver.live, 0);

// Initial fit throws: torn down immediately, reported once, nothing left behind, unmount is a safe no-op.
r = run({regionThrows: true});
assert.equal(r.failures(), 1); assert.equal(r.metrics.created, 1); assert.equal(r.metrics.destroyed, 1); assert.equal(r.metrics.listeners, 0); assert.equal(FakeObserver.live, 0);
r.cleanup(); assert.equal(r.metrics.destroyed, 1);

// Annotation removal throws: the map is still destroyed.
r = run({removeThrows: true});
r.cleanup(); assert.equal(r.metrics.destroyed, 1); assert.equal(r.metrics.listeners, 0); assert.equal(FakeObserver.live, 0);

// A pin cannot be built mid-setup: the map made so far is destroyed and the failure reported.
r = run({annotationThrows: true});
assert.equal(r.failures(), 1); assert.equal(r.metrics.created, 1); assert.equal(r.metrics.destroyed, 1); assert.equal(r.metrics.listeners, 0);

console.log('PASS Waypoint Apple map session: setup failures tear down the map, error listener and observer once; destroy runs even when annotation removal fails; cleanup is idempotent.');
