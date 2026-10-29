import assert from 'node:assert/strict';
import { appleMapEngine, type MapKit } from '../desktop-ui/lib/apple-mapkit';

class Coordinate { constructor(public latitude: number, public longitude: number) {} }
class Span { constructor(public latitudeDelta: number, public longitudeDelta: number) {} }
class Region { constructor(public center: Coordinate, public span: Span) {} }
class FakeElement { closest() { return null; } }
class Control extends FakeElement { closest() { return this as never; } }
let native: FakeMap;
let options: Record<string, unknown>;
class FakeMap extends EventTarget {
  region = new Region(new Coordinate(30, -90), new Span(1, 1));
  constructor(_host: unknown, opts: Record<string, unknown>) { super(); native = this; options = opts; }
  convertPointOnPageToCoordinate() { return this.region.center; }
  destroy() {}
}
let wheel: ((event: WheelEvent) => void) | undefined;
const host = {
  clientWidth: 700, clientHeight: 420, prepend() {},
  addEventListener(name: string, callback: typeof wheel, opts: AddEventListenerOptions) {
    assert.equal(name, 'wheel'); assert.equal(opts.capture, true); assert.equal(opts.passive, false); wheel = callback;
  },
  removeEventListener(name: string, callback: typeof wheel, capture: boolean) {
    assert.equal(name, 'wheel'); assert.equal(callback, wheel); assert.equal(capture, true); wheel = undefined;
  },
} as unknown as HTMLElement;
Object.assign(globalThis, {
  window: {}, Element: FakeElement, DOMPoint: class { constructor(public x: number, public y: number) {} },
  document: { documentElement: { dataset: {} }, createElement: () => ({ remove() {} }) },
  MutationObserver: class { observe() {} disconnect() {} },
});
const kit = Object.assign(new EventTarget(), { Coordinate, CoordinateSpan: Span, CoordinateRegion: Region, Map: FakeMap }) as unknown as MapKit;
const view = appleMapEngine(kit, () => {}).map(host, { zoomControl: true, scrollWheelZoom: true });
assert.equal(options!.isZoomEnabled, true, 'Keep native touch pinch');
assert.equal(options!.isScrollEnabled, true, 'Keep native drag pan');
assert.ok(!('isPitchEnabled' in options!));
function input(deltaY: number, deltaMode = 0, ctrlKey = false, target = new FakeElement()) {
  let prevented = false, stopped = false;
  wheel!({ deltaY, deltaMode, ctrlKey, target, pageX: 350, pageY: 210,
    preventDefault() { prevented = true; }, stopPropagation() { stopped = true; },
  } as unknown as WheelEvent);
  return { prevented, stopped };
}
const before = native!.region.span.longitudeDelta;
assert.deepEqual(input(-120), { prevented: true, stopped: true });
assert.ok(native!.region.span.longitudeDelta < before, 'Upward scroll zooms in');
input(120);
assert.ok(Math.abs(native!.region.span.longitudeDelta - before) < 1e-9, 'Reverse scroll restores scale');
input(-40, 0, true);
assert.ok(native!.region.span.longitudeDelta < before, 'Trackpad pinch zooms in');
const pinch = native!.region.span.longitudeDelta;
assert.deepEqual(input(-120, 0, false, new Control()), { prevented: false, stopped: false });
assert.equal(native!.region.span.longitudeDelta, pinch, 'Controls do not zoom');
assert.deepEqual(input(0), { prevented: false, stopped: false });
input(3, 1);
assert.ok(native!.region.span.longitudeDelta > pinch, 'Line-mode wheel zooms out');
input(1, 2);
assert.ok(Number.isFinite(native!.region.span.longitudeDelta), 'Page-mode wheel stays bounded');
view.remove();
assert.equal(wheel, undefined, 'Unmount removes wheel interception');
console.log('Apple gestures: scroll, pinch, native gestures, controls, units, teardown PASS.');
