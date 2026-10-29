import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ScheduleMap from '../schedule-map';
import { appleMapEngine, type MapKit } from '../lib/apple-mapkit';
import type { TruckGpsRoute } from '../lib/gps-route-contract';
import type { ScheduleAppointment, ScheduleTruck } from '../lib/schedule-contract';
import '../app/globals.css';
import '../live-schedule.css';
import '../schedule-selection.css';

// SDK stand-in for deterministic integration tests. No provider requests, no
// customer data. It models the public SDK surface, not Leaflet internals.
class Coordinate { constructor(public latitude: number, public longitude: number) {} }
class Span { constructor(public latitudeDelta: number, public longitudeDelta: number) {} }
class Region { constructor(public center: Coordinate, public span: Span) {} }
class Annotation extends EventTarget { element: HTMLElement; constructor(public coordinate: Coordinate, factory: () => HTMLElement, public options: Record<string, unknown>) { super(); this.element = factory(); } }
class Overlay extends EventTarget { constructor(public coordinates: Coordinate[], public options: Record<string, unknown>) { super(); } }
const metrics = { created: 0, destroyed: 0, active: 0, annotations: 0 };
let lastMap: FakeMap;
class FakeMap extends EventTarget {
  private value = new Region(new Coordinate(30, -90), new Span(1, 1));
  annotations = new Set<Annotation>(); overlays = new Set<Overlay>();
  private scheme = 'light';
  get colorScheme() { return this.scheme; }
  set colorScheme(value: string) { this.scheme = value; this.host.style.background = value === 'dark' ? '#26332c' : '#e2e8e1'; }
  constructor(public host: HTMLElement) { super(); lastMap = this; metrics.created++; metrics.active++; host.style.background = '#e2e8e1'; }
  get region() { return this.value; }
  set region(region: Region) { this.value = region; this.render(); queueMicrotask(() => this.dispatchEvent(new Event('region-change-end'))); }
  get center() { return this.value.center; }
  set center(center: Coordinate) { this.region = new Region(center, this.region.span); }
  convertCoordinateToPointOnPage(coordinate: Coordinate) {
    const r = this.host.getBoundingClientRect();
    return { x: r.left + window.scrollX + r.width * (.5 + (coordinate.longitude - this.region.center.longitude) / this.region.span.longitudeDelta), y: r.top + window.scrollY + r.height * (.5 - (coordinate.latitude - this.region.center.latitude) / this.region.span.latitudeDelta) };
  }
  render() { const r = this.host.getBoundingClientRect(); this.annotations.forEach(a => { const p = this.convertCoordinateToPointOnPage(a.coordinate); const offset = a.options.anchorOffset as DOMPoint; Object.assign(a.element.style, { position: 'absolute', left: `${p.x - r.left - window.scrollX + offset.x}px`, top: `${p.y - r.top - window.scrollY + offset.y}px`, transform: 'translate(-50%, -100%)' }); }); }
  addAnnotation(item: Annotation) { this.annotations.add(item); this.host.append(item.element); this.render(); metrics.annotations = this.annotations.size; }
  removeAnnotation(item: Annotation) { this.annotations.delete(item); item.element.remove(); metrics.annotations = this.annotations.size; }
  addOverlay(item: Overlay) { this.overlays.add(item); }
  removeOverlay(item: Overlay) { this.overlays.delete(item); }
  destroy() { metrics.destroyed++; metrics.active--; this.host.replaceChildren(); }
}
const kit = Object.assign(new EventTarget(), { Coordinate, CoordinateSpan: Span, CoordinateRegion: Region, Map: FakeMap, Annotation, PolylineOverlay: Overlay, Style: class { constructor(public options: unknown) {} } }) as unknown as MapKit;
const engine = appleMapEngine(kit, () => {});
const exact = { recordId: 'exact', jkNumber: 'JKTEST1', customerName: 'Exact Example', address: 'Synthetic address', appointmentTime: '9 AM–10 AM', status: 'Confirmed', truck: 'Truck 3', location: { latitude: 30, longitude: -90 } } as ScheduleAppointment;
const approximate = { ...exact, recordId: 'approx', jkNumber: 'JKTEST2', customerName: 'Approximate Example', location: null, mapFallback: { location: { latitude: 30.005, longitude: -90.005 }, matchedAddress: 'Synthetic approximate pin', source: 'fixture', precision: 'approximate' } } as unknown as ScheduleAppointment;
const truck = { truck: 'Truck 3', latitude: 30.01, longitude: -90.01, lastGpsUpdate: new Date().toISOString(), ignition: 'ON', speedMph: 20, operationalStatus: 'Driving' } as ScheduleTruck;
const routePoints = [[30,-90],[30.15,-89.95],[30.3,-90.2]].map(([latitude,longitude],i)=>({latitude,longitude,timestamp:`2026-10-29T${13+i}:00:00.000Z`}));
const route: TruckGpsRoute = {date:'2026-10-29',truck:'Truck 3',sourceVersion:'synthetic',status:'available',observedAt:routePoints[2].timestamp,coveredThrough:routePoints[2].timestamp,points:routePoints,trips:[],paths:[routePoints],gapLinks:[],gaps:0,rejected:0,streets:{sourceVersion:'synthetic',status:'available',unmatched:0,paths:[{sourceEdge:0,kind:'matched',points:routePoints.slice(0,2)},{sourceEdge:1,kind:'matched',points:routePoints.slice(1)}]}};
function Fixture() {
  const [mode,setMode] = useState<'overview'|'route'>('overview');
  const [selected, select] = useState<string | null>(null), [selectedTruck, selectTruck] = useState<string | null>(null), [mounted, mount] = useState(true), [narrow, setNarrow] = useState(false), [checks, setChecks] = useState('Waiting');
  useEffect(() => { const timer = setInterval(() => {
    const label = document.querySelector('[data-map-pin="appointment:approx"]')?.getAttribute('aria-label') || '';
    const exactAnnotation = [...(lastMap?.annotations || [])].find(a => a.element.querySelector('[data-map-pin="appointment:exact"]'));
    const preserved = !exactAnnotation || (exactAnnotation.coordinate.latitude === 30 && exactAnnotation.coordinate.longitude === -90);
    const fullRoute = mode !== 'route' || routePoints.every(point => { const p = lastMap.convertCoordinateToPointOnPage(point); const r = lastMap.host.getBoundingClientRect(); return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom; });
    setChecks(`${fullRoute ? 'PASS' : 'FAIL'} route bounds · ${lastMap?.overlays.size || 0} route overlays · ${lastMap?.colorScheme} · ${preserved ? 'PASS' : 'FAIL'} source coordinates · ${!label || /approximate|area locator/.test(label) ? 'PASS' : 'FAIL'} provenance · ${metrics.active === (mounted ? 1 : 0) ? 'PASS' : 'FAIL'} lifecycle · created ${metrics.created}, destroyed ${metrics.destroyed} · selected ${selected || selectedTruck || 'none'}`);
  }, 100); return () => clearInterval(timer); }, [mounted, selected, selectedTruck, mode]);
  return <main className="ops-live" style={{ padding: 16 }}><h1>Apple Maps adapter · synthetic SDK</h1><p>No live Apple map or operational data in this fixture.</p><button onClick={() => setNarrow(!narrow)}>Toggle phone width</button> <button onClick={() => mount(!mounted)}>Toggle map</button> <button onClick={() => { select(null); selectTruck(null); }}>Reset selection</button> <button onClick={() => { document.documentElement.dataset.opsTheme = document.documentElement.dataset.opsTheme === 'dark' ? 'light' : 'dark'; }}>Toggle theme</button>
  <div style={{ width: narrow ? 350 : 700, maxWidth: '100%', height: 420, position: 'relative', marginTop: 12 }}>{mounted && <ScheduleMap mapEngine={engine} appointments={[exact, approximate]} trucks={[truck]} selected={selected} selectedTruck={selectedTruck} gpsRoute={route} truckMapView={mode} onSelectTrip={()=>setMode('route')} scope="ALL" resetKey={selected === null && selectedTruck === null ? metrics.created : 0} date="2026-10-29" onSelect={id => { select(id); selectTruck(null); }} onSelectTruck={name => { selectTruck(name); select(null); setMode('overview'); }} />}</div>
  <p role="status">{checks}</p></main>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<Fixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
