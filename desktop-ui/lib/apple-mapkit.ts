import type { Coordinate, Listener, MapEngine, MapGroup, MapIcon, MapLayer, MapTooltip, MapView, Point } from './map-engine';

// Minimal SDK contract for the full-map library. No search, geocoder or directions
// services are loaded or called by this display integration.
type AppleCoordinate = { latitude: number; longitude: number };
type Region = { center: AppleCoordinate; span: { latitudeDelta: number; longitudeDelta: number } };
type AppleItem = EventTarget & { data?: unknown };
type AppleMap = EventTarget & {
  region: Region; center: AppleCoordinate; colorScheme: string;
  addAnnotation(item: AppleItem): void; removeAnnotation(item: AppleItem): void;
  addOverlay(item: AppleItem): void; removeOverlay(item: AppleItem): void;
  convertCoordinateToPointOnPage(point: AppleCoordinate): Point;
  convertPointOnPageToCoordinate(point: DOMPoint): AppleCoordinate;
  destroy(): void;
};
export type MapKit = EventTarget & {
  Coordinate: new (lat: number, lon: number) => AppleCoordinate;
  CoordinateSpan: new (lat: number, lon: number) => Region['span'];
  CoordinateRegion: new (center: AppleCoordinate, span: Region['span']) => Region;
  Map: new (element: HTMLElement, options: Record<string, unknown>) => AppleMap;
  Annotation: new (coordinate: AppleCoordinate, factory: () => HTMLElement, options: Record<string, unknown>) => AppleItem;
  PolylineOverlay: new (coordinates: AppleCoordinate[], options: Record<string, unknown>) => AppleItem;
  Style: new (options: Record<string, unknown>) => unknown;
};

declare global { interface Window { mapkit?: MapKit; opscenterMapKitReady?: (error?: unknown) => void } }
let sdkPromise: Promise<MapKit> | undefined;
// Authorization can fail before React constructs its first map. Remember that
// failure for the entire page, including future component remounts.
const monitoredKits = new WeakSet<MapKit>();
const failedKits = new WeakSet<MapKit>();
function monitorKit(kit: MapKit) {
  if (monitoredKits.has(kit)) return;
  monitoredKits.add(kit);
  kit.addEventListener('error', () => failedKits.add(kit));
}
function requireHealthyKit(kit: MapKit) {
  monitorKit(kit);
  if (failedKits.has(kit)) throw new Error('Apple Maps is unavailable for this page.');
}
export function loadAppleMapKit(token: string): Promise<MapKit> {
  if (sdkPromise) return sdkPromise.then(kit => { requireHealthyKit(kit); return kit; });
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error || !window.mapkit?.Map || !window.mapkit.Annotation) {
        script.remove();
        reject(new Error('Apple Maps could not load.'));
      } else {
        try { requireHealthyKit(window.mapkit); resolve(window.mapkit); }
        catch (error) { reject(error); }
      }
    };
    const timeout = window.setTimeout(() => finish(new Error('timeout')), 12000);
    window.opscenterMapKitReady = finish;
    script.src = 'https://cdn.apple-mapkit.com/mk/6/mapkit.core.js';
    script.crossOrigin = 'anonymous'; script.async = true;
    script.dataset.callback = 'opscenterMapKitReady';
    script.dataset.libraries = 'full-map'; script.dataset.token = token;
    script.onload = () => { if (window.mapkit) monitorKit(window.mapkit); };
    script.onerror = () => finish(new Error('script'));
    document.head.append(script);
  });
  // One bounded attempt per page. Reload can retry; component remounts cannot loop.
  return sdkPromise;
}

export function appleMapEngine(kit: MapKit, onFailure: () => void): MapEngine {
  monitorKit(kit);
  const coord = (point: Coordinate) => new kit.Coordinate(point[0], point[1]);
  class View implements MapView {
    readonly native: AppleMap;
    readonly canvas: HTMLDivElement;
    readonly tips = new Set<HTMLElement>();
    readonly groups = new Set<Group>();
    private callbacks = new Map<Listener, EventListener>();
    private darkObserver: MutationObserver;
    private regionEnd: EventListener;
    private error: EventListener;
    private wheel: (event: WheelEvent) => void;
    attributionControl = { setPrefix: () => {} }; // Apple's attribution stays intact.
    constructor(readonly host: HTMLElement) {
      requireHealthyKit(kit);
      this.canvas = document.createElement('div');
      this.canvas.className = 'apple-map-canvas';
      host.prepend(this.canvas);
      try {
        this.native = new kit.Map(this.canvas, { showsZoomControl: true, showsMapTypeControl: false, showsUserLocationControl: false, isRotationEnabled: false, isZoomEnabled: true, isScrollEnabled: true });
      } catch (error) { failedKits.add(kit); this.canvas.remove(); throw error; }
      this.error = () => onFailure();
      kit.addEventListener('error', this.error);
      const theme = () => { this.native.colorScheme = document.documentElement.dataset.opsTheme === 'dark' ? 'dark' : 'light'; };
      theme();
      this.darkObserver = new MutationObserver(theme);
      this.darkObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ops-theme'] });
      this.regionEnd = () => this.tips.forEach(tip => { tip.hidden = true; });
      this.native.addEventListener('region-change-start', this.regionEnd);
      // Retain the previous map's wheel/trackpad scroll-to-zoom behavior. Capture
      // before the SDK can pan, but let ScheduleMap's same-host listener pause
      // Follow. Native touch pinch and pointer drag remain enabled.
      this.wheel = event => {
        if (!event.deltaY || !Number.isFinite(event.deltaY) || (event.target instanceof Element && event.target.closest('.truck-map-view-controls'))) return;
        event.preventDefault();
        event.stopPropagation();
        const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(host.clientHeight, 1) : 1);
        const currentZoom = this.getZoom();
        const nextZoom = Math.max(2, Math.min(20, currentZoom - Math.max(-1, Math.min(1, pixels / (event.ctrlKey ? 80 : 240)))));
        const scale = 2 ** (currentZoom - nextZoom);
        const region = this.native.region;
        const anchor = this.native.convertPointOnPageToCoordinate(new DOMPoint(event.pageX, event.pageY));
        const center = new kit.Coordinate(anchor.latitude + (region.center.latitude - anchor.latitude) * scale, anchor.longitude + (region.center.longitude - anchor.longitude) * scale);
        this.native.region = new kit.CoordinateRegion(center, new kit.CoordinateSpan(region.span.latitudeDelta * scale, region.span.longitudeDelta * scale));
      };
      host.addEventListener('wheel', this.wheel, { capture: true, passive: false });
    }
    setView(point: Coordinate, zoom: number) {
      const width = Math.max(this.host.clientWidth, 1), height = Math.max(this.host.clientHeight, 1);
      const longitudeDelta = 360 * width / (256 * 2 ** zoom);
      this.native.region = new kit.CoordinateRegion(coord(point), new kit.CoordinateSpan(longitudeDelta * height / width * Math.cos(point[0] * Math.PI / 180), longitudeDelta));
      return this;
    }
    fitBounds(points: Coordinate[], options: { padding: Coordinate; maxZoom: number }) {
      if (!points.length) return this;
      const lat = points.map(p => p[0]), lon = points.map(p => p[1]);
      const south = Math.min(...lat), north = Math.max(...lat), west = Math.min(...lon), east = Math.max(...lon);
      const center: Coordinate = [(south + north) / 2, (west + east) / 2];
      const width = Math.max(this.host.clientWidth, 1), height = Math.max(this.host.clientHeight, 1);
      const availableWidth = Math.max(width - 2 * options.padding[0], 1), availableHeight = Math.max(height - 2 * options.padding[1], 1);
      const delta = Math.max((east - west) * width / availableWidth, (north - south) / Math.cos(center[0] * Math.PI / 180) * width / availableHeight, 360 * width / (256 * 2 ** options.maxZoom));
      this.native.region = new kit.CoordinateRegion(coord(center), new kit.CoordinateSpan(delta * height / width * Math.cos(center[0] * Math.PI / 180), delta));
      return this;
    }
    panTo(point: Coordinate) { this.native.center = coord(point); return this; }
    getZoom() { return Math.log2(360 * Math.max(this.host.clientWidth, 1) / (256 * Math.max(this.native.region.span.longitudeDelta, 0.000001))); }
    getSize() { return { x: this.host.clientWidth, y: this.host.clientHeight }; }
    latLngToContainerPoint(point: Coordinate) {
      const position = this.native.convertCoordinateToPointOnPage(coord(point));
      const rect = this.host.getBoundingClientRect();
      return { x: position.x - rect.left - window.scrollX, y: position.y - rect.top - window.scrollY };
    }
    on(events: string, listener: Listener) {
      // ScheduleMap handles pointer/wheel/keyboard gestures on its host. A region
      // change may be programmatic, so it must not be treated as a user drag.
      if (events === 'dragstart') return this;
      const wrapped: EventListener = () => listener();
      this.callbacks.set(listener, wrapped);
      this.native.addEventListener('region-change-end', wrapped);
      return this;
    }
    off(_events: string, listener: Listener) {
      const wrapped = this.callbacks.get(listener);
      if (wrapped) this.native.removeEventListener('region-change-end', wrapped);
      this.callbacks.delete(listener); return this;
    }
    closePopup() { this.tips.forEach(tip => { tip.hidden = true; }); return this; }
    invalidateSize() { this.callbacks.forEach(callback => callback(new Event('resize'))); return this; }
    remove() {
      this.host.removeEventListener('wheel', this.wheel, true);
      this.darkObserver.disconnect();
      this.groups.forEach(group => group.clearLayers());
      this.callbacks.forEach(callback => this.native.removeEventListener('region-change-end', callback));
      kit.removeEventListener('error', this.error);
      this.native.removeEventListener('region-change-start', this.regionEnd);
      this.native.destroy(); this.canvas.remove(); this.tips.forEach(tip => tip.remove());
    }
  }
  class Group implements MapGroup {
    view?: View;
    layers = new Set<Layer>();
    addTo(view: MapView) { this.view = view as View; this.view.groups.add(this); return this; }
    clearLayers() { this.layers.forEach(layer => layer.remove()); this.layers.clear(); }
  }
  class Layer implements MapLayer {
    group?: Group;
    tooltip?: MapTooltip;
    tip?: HTMLElement;
    listeners = new Map<string, Listener>();
    private hover?: () => void;
    private leave?: () => void;
    private selected?: EventListener;
    constructor(readonly native: AppleItem, readonly overlay: boolean, readonly point?: Coordinate, readonly element?: HTMLElement) {}
    addTo(group: MapGroup) {
      this.group = group as Group; this.group.layers.add(this);
      const view = this.group.view!;
      if (this.overlay) view.native.addOverlay(this.native); else view.native.addAnnotation(this.native);
      this.selected = (event: Event) => {
        const selected = event as Event & { overlay?: AppleItem; annotation?: AppleItem };
        if (selected.overlay === this.native || selected.annotation === this.native) { this.listeners.get('click')?.(); this.openTooltip(); }
      };
      view.native.addEventListener('select', this.selected);
      this.hover = () => this.openTooltip(); this.leave = () => this.closeTooltip();
      this.element?.addEventListener('mouseenter', this.hover); this.element?.addEventListener('mouseleave', this.leave);
      return this;
    }
    bindTooltip(content: HTMLElement, options: { className?: string; offset?: Point } = {}) {
      this.tip = document.createElement('div'); this.tip.hidden = true;
      this.tip.className = `apple-map-tooltip ${options.className || ''}`; this.tip.append(content);
      this.tooltip = {
        options: { offset: options.offset || { x: 0, y: -15 } }, getElement: () => this.tip,
        update: () => {
          if (!this.group?.view || !this.point || !this.tip || !this.tooltip) return;
          const p = this.group.view.latLngToContainerPoint(this.point);
          this.tip.style.left = `${p.x + this.tooltip.options.offset.x}px`; this.tip.style.top = `${p.y + this.tooltip.options.offset.y}px`;
        },
      };
      return this;
    }
    on(event: string, listener: Listener) { this.listeners.set(event, listener); return this; }
    openTooltip() {
      if (!this.tip || !this.group?.view) return;
      this.group.view.host.append(this.tip); this.group.view.tips.add(this.tip);
      this.tip.hidden = false; this.tooltip?.update(); this.listeners.get('tooltipopen')?.();
    }
    closeTooltip() { if (this.tip) this.tip.hidden = true; }
    getTooltip() { return this.tooltip; }
    remove() {
      const view = this.group?.view;
      if (view) {
        if (this.overlay) view.native.removeOverlay(this.native); else view.native.removeAnnotation(this.native);
        if (this.selected) view.native.removeEventListener('select', this.selected);
        if (this.tip) view.tips.delete(this.tip);
      }
      if (this.hover) this.element?.removeEventListener('mouseenter', this.hover);
      if (this.leave) this.element?.removeEventListener('mouseleave', this.leave);
      this.tip?.remove();
    }
  }
  function marker(point: Coordinate, icon: MapIcon, selected: boolean) {
    const element = document.createElement('div'); element.className = icon.className; element.style.zIndex = selected ? '2' : '1';
    element.style.width = `${icon.iconSize[0]}px`; element.style.height = `${icon.iconSize[1]}px`; element.append(icon.html);
    const annotation = new kit.Annotation(coord(point), () => element, {
      anchorOffset: new DOMPoint(icon.iconSize[0] / 2 - icon.iconAnchor[0], icon.iconSize[1] - icon.iconAnchor[1]),
      animates: false, enabled: true, calloutEnabled: false, displayPriority: 1000,
    });
    return new Layer(annotation, false, point, element);
  }
  return {
    name: 'apple', map: host => new View(host), layerGroup: () => new Group(),
    marker: (point, options) => marker(point, options.icon, options.zIndexOffset > 1000),
    polyline: (points, options) => new Layer(new kit.PolylineOverlay(points.map(coord), {
      style: new kit.Style({ strokeColor: options.color, lineWidth: options.weight, strokeOpacity: options.opacity, lineCap: 'round', lineJoin: 'round' }),
      enabled: options.interactive,
    }), true, points[Math.floor(points.length / 2)]),
    circleMarker: (point, options) => {
      const dot = document.createElement('span'); dot.className = options.className;
      Object.assign(dot.style, { display: 'block', width: `${options.radius * 2}px`, height: `${options.radius * 2}px`, borderRadius: '50%', background: options.fillColor, border: `${options.weight}px solid ${options.color}` });
      return marker(point, { className: 'apple-gps-point', html: dot, iconSize: [options.radius * 2, options.radius * 2], iconAnchor: [options.radius, options.radius] }, false);
    },
    divIcon: icon => icon, point: (x, y) => ({ x, y }),
    DomEvent: { disableClickPropagation(element) { for (const name of ['pointerdown', 'mousedown', 'touchstart', 'dblclick']) element.addEventListener(name, event => event.stopPropagation()); } },
  };
}
