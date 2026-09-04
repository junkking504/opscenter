import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ScheduleAppointment, ScheduleTruck } from './lib/schedule-contract';
import { appointmentRegion, appointmentStatus, truckLabel } from './lib/schedule-contract';
import { spreadMapPins, territoryMapCenters } from './lib/schedule-map-layout';

type Props = {
  appointments: ScheduleAppointment[]; trucks: ScheduleTruck[];
  selected: string | null; selectedTruck: string | null;
  scope: string; resetKey: number; date: string;
  onSelect: (id: string) => void; onSelectTruck: (truck: string) => void;
};
export default function ScheduleMap(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const current = useRef(props);
  current.current = props;
  const fitted = useRef('');
  const focused = useRef('');
  useEffect(() => {
    if (!host.current) return;
    const view = L.map(host.current, { zoomControl: true, scrollWheelZoom: true }).setView([30.14, -90.5], 8);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).addTo(view);
    map.current = view;
    markers.current = L.layerGroup().addTo(view);
    const observer = new ResizeObserver(() => view.invalidateSize());
    observer.observe(host.current);
    return () => { observer.disconnect(); view.remove(); map.current = null; markers.current = null; fitted.current = ''; focused.current = ''; };
  }, []);
  // Avoid rebuilding marker DOM on unrelated parent renders, preserving keyboard focus.
  const signature = JSON.stringify([props.appointments, props.trucks, props.selected, props.selectedTruck, props.scope, props.resetKey, props.date]);
  useEffect(() => {
    const view = map.current;
    const layer = markers.current;
    if (!view || !layer) return;
    const { appointments, trucks, selected, selectedTruck, scope, resetKey, date } = current.current;
    type Pin = { id: string; coordinate: L.LatLngTuple; label: string; text: string; className: string; selected: boolean; select: () => void };
    const pins: Pin[] = [];
    const appointmentBounds: L.LatLngTuple[] = [];
    appointments.forEach((job, index) => {
      if (!job.location) return;
      const coordinate: L.LatLngTuple = [job.location.latitude, job.location.longitude];
      appointmentBounds.push(coordinate);
      pins.push({ id: `appointment:${job.recordId}`, coordinate,
        text: String(index + 1), label: `Open appointment ${job.jkNumber}, ${job.appointmentTime}, ${job.customerName}`,
        className: `appointment-marker territory-${appointmentRegion(job).code.toLowerCase()} ${appointmentStatus(job).toLowerCase().replaceAll(' ', '-')}`,
        selected: selected === job.recordId, select: () => current.current.onSelect(job.recordId) });
    });
    trucks.forEach(truck => {
      if (truck.latitude === null || truck.longitude === null) return;
      const name = truckLabel(truck.truck);
      const age = Date.now() - Date.parse(truck.lastGpsUpdate || '');
      const fresh = Number.isFinite(age) && age >= 0 && age <= 180_000;
      pins.push({ id: `truck:${name}`, coordinate: [truck.latitude, truck.longitude], text: name.replace('Truck ', 'T'),
        label: `Select ${name}, ${fresh ? 'Recent GPS' : 'Last Known Position'}`,
        className: `truck-marker${fresh ? '' : ' stale'}`, selected: selectedTruck === name,
        select: () => current.current.onSelectTruck(name) });
    });
    const fitKey = `${date}:${scope}:${resetKey}:${appointments.map(job => job.recordId).sort().join('|')}`;
    if (fitted.current !== fitKey) {
      const bounds = scope === 'ALL' ? pins.map(pin => pin.coordinate) : appointmentBounds;
      if (bounds.length) view.fitBounds(bounds, { padding: [65, 65], maxZoom: 12, animate: false });
      else if (territoryMapCenters[scope.split(':')[0]]) view.setView(territoryMapCenters[scope.split(':')[0]], 11, { animate: false });
      else view.setView([30.14, -90.5], 8, { animate: false });
      fitted.current = fitKey;
    }
    const focusKey = selected ? `appointment:${selected}` : selectedTruck ? `truck:${selectedTruck}` : '';
    const focusVersion = `${focusKey}:${resetKey}`;
    if (focusKey && focused.current !== focusVersion) {
      const pin = pins.find(pin => pin.id === focusKey);
      if (pin) view.setView(pin.coordinate, Math.max(view.getZoom(), 12), { animate: false });
    }
    focused.current = focusVersion;
    const render = () => {
      const activeId = host.current?.contains(document.activeElement) ? (document.activeElement as HTMLElement)?.dataset.mapPin : undefined;
      layer.clearLayers();
      const points = spreadMapPins(pins.map(pin => ({ id: pin.id, ...view.latLngToLayerPoint(pin.coordinate) })));
      for (const pin of pins) {
        const point = points.find(candidate => candidate.id === pin.id)!;
        const source = view.latLngToLayerPoint(pin.coordinate);
        const coordinate = view.layerPointToLatLng(L.point(point.x, point.y));
        if (Math.hypot(point.x - source.x, point.y - source.y) > 1) {
          L.polyline([pin.coordinate, coordinate], { color: '#596b78', weight: 1, opacity: .7, dashArray: '3 3', interactive: false }).addTo(layer);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `map-marker ${pin.className}${pin.selected ? ' route-selected' : ''}`;
        button.textContent = pin.text;
        button.dataset.mapPin = pin.id;
        button.setAttribute('aria-label', pin.label);
        button.setAttribute('aria-pressed', String(pin.selected));
        L.DomEvent.disableClickPropagation(button);
        button.onclick = event => { event.stopPropagation(); pin.select(); };
        const tooltip = document.createElement('span'); tooltip.textContent = pin.label;
        L.marker(coordinate, { keyboard: false, icon: L.divIcon({ className: 'live-map-pin', html: button, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: pin.selected ? 900 : 0 }).bindTooltip(tooltip).addTo(layer);
        if (activeId === pin.id) button.focus({ preventScroll: true });
      }
    };
    render();
    view.on('zoomend moveend', render);
    return () => { view.off('zoomend moveend', render); };
  }, [signature]);
  return <div ref={host} className="live-schedule-map" aria-label="Verified appointment locations and truck GPS" />;
}
