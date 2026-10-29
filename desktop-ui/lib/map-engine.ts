import L from 'leaflet';

export type Coordinate = [number, number];
export type Point = { x: number; y: number };
export type Listener = () => void;
export interface MapView {
  setView(point: Coordinate, zoom: number, options?: { animate?: boolean }): MapView;
  fitBounds(points: Coordinate[], options: { padding: Coordinate; maxZoom: number; animate?: boolean }): MapView;
  panTo(point: Coordinate, options?: { animate?: boolean }): MapView;
  getZoom(): number;
  getSize(): Point;
  latLngToContainerPoint(point: Coordinate): Point;
  on(events: string, callback: Listener): MapView;
  off(events: string, callback: Listener): MapView;
  closePopup(): MapView;
  invalidateSize(options: { pan: boolean }): MapView;
  remove(): void;
  attributionControl: { setPrefix(value: false): void };
}
export interface MapGroup {
  clearLayers(): void;
  addTo(view: MapView): MapGroup;
}
export interface MapTooltip {
  options: { offset: Point };
  getElement(): HTMLElement | undefined;
  update(): void;
}
export interface MapLayer {
  addTo(group: MapGroup): MapLayer;
  bindTooltip(element: HTMLElement, options?: { className?: string; direction?: string; offset?: Point; opacity?: number; permanent?: boolean; sticky?: boolean }): MapLayer;
  on(event: string, listener: Listener): MapLayer;
  openTooltip(): void;
  closeTooltip(): void;
  getTooltip(): MapTooltip | undefined;
}
export type MapIcon = { className: string; html: HTMLElement; iconSize: Coordinate; iconAnchor: Coordinate };
export interface MapEngine {
  name: 'apple' | 'openstreetmap';
  map(host: HTMLElement, options: { zoomControl: boolean; scrollWheelZoom: boolean }): MapView;
  layerGroup(): MapGroup;
  marker(point: Coordinate, options: { keyboard: boolean; icon: MapIcon; zIndexOffset: number }): MapLayer;
  polyline(points: Coordinate[], options: { color: string; weight: number; opacity: number; lineCap: string; lineJoin: string; interactive: boolean; className: string }): MapLayer;
  circleMarker(point: Coordinate, options: { radius: number; color: string; fillColor: string; fillOpacity: number; weight: number; interactive: boolean; className: string }): MapLayer;
  divIcon(options: MapIcon): MapIcon;
  point(x: number, y: number): Point;
  DomEvent: { disableClickPropagation(element: HTMLElement): void };
}

// The facade deliberately exposes only the calls used by ScheduleMap. Leaflet
// objects implement these calls directly; Apple implements the same small surface.
export const leafletEngine: MapEngine = {
  name: 'openstreetmap',
  map(host, options) {
    const view = L.map(host, options);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 20, maxNativeZoom: 19, updateWhenIdle: true, keepBuffer: 1,
    }).addTo(view);
    return view as unknown as MapView;
  },
  layerGroup: () => L.layerGroup() as unknown as MapGroup,
  marker: (point, options) => L.marker(point, { ...options, icon: L.divIcon(options.icon) }) as unknown as MapLayer,
  polyline: (points, options) => L.polyline(points, { ...options, lineCap: 'round', lineJoin: 'round' }) as unknown as MapLayer,
  circleMarker: (point, options) => L.circleMarker(point, options) as unknown as MapLayer,
  divIcon: options => options,
  point: (x, y) => ({ x, y }),
  DomEvent: L.DomEvent,
};
