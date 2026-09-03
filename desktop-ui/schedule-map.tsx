import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ScheduleAppointment, ScheduleTruck } from './lib/schedule-contract';
import { appointmentStatus, truckLabel } from './lib/schedule-contract';

export default function ScheduleMap({ appointments, trucks, selected, onSelect }: { appointments: ScheduleAppointment[]; trucks: ScheduleTruck[]; selected: string | null; onSelect: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const selection = useRef(onSelect);
  selection.current = onSelect;
  const fitted = useRef('');
  useEffect(() => {
    if (!host.current) return;
    const view = L.map(host.current, { zoomControl: true, scrollWheelZoom: false }).setView([30.14, -90.5], 8);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).addTo(view);
    map.current = view;
    markers.current = L.layerGroup().addTo(view);
    const observer = new ResizeObserver(() => view.invalidateSize());
    observer.observe(host.current);
    return () => { observer.disconnect(); view.remove(); map.current = null; markers.current = null; fitted.current = ''; };
  }, []);
  useEffect(() => {
    const view = map.current;
    const layer = markers.current;
    if (!view || !layer) return;
    layer.clearLayers();
    const bounds: L.LatLngTuple[] = [];
    appointments.forEach((job, index) => {
      if (!job.location) return;
      const coordinate: L.LatLngTuple = [job.location.latitude, job.location.longitude];
      bounds.push(coordinate);
      const button = document.createElement('button');
      button.className = `map-marker appointment-marker${appointmentStatus(job) === 'Completed' ? ' completed' : ''}${selected === job.recordId ? ' route-selected' : ''}`;
      button.textContent = String(index + 1);
      button.setAttribute('aria-label', `Compare routes to ${job.jkNumber}, ${job.appointmentTime}, ${job.customerName}`);
      button.onclick = () => selection.current(job.recordId);
      const tooltip = document.createElement('span');
      tooltip.textContent = `${job.jkNumber} · ${job.appointmentTime} · ${job.customerName}`;
      L.marker(coordinate, { icon: L.divIcon({ className: 'live-map-pin', html: button, iconSize: [24, 24], iconAnchor: [0, 0] }), zIndexOffset: selected === job.recordId ? 900 : 0 }).bindTooltip(tooltip).addTo(layer);
    });
    trucks.forEach(truck => {
      if (truck.latitude === null || truck.longitude === null) return;
      const coordinate: L.LatLngTuple = [truck.latitude, truck.longitude];
      bounds.push(coordinate);
      const age = Date.now() - Date.parse(truck.lastGpsUpdate || '');
      const fresh = Number.isFinite(age) && age >= 0 && age <= 180_000;
      const button = document.createElement('a');
      button.className = `map-marker truck-marker${fresh ? '' : ' stale'}`;
      button.textContent = truckLabel(truck.truck).replace('Truck ', 'T');
      button.href = `https://www.google.com/maps/search/?api=1&query=${truck.latitude},${truck.longitude}`;
      button.target = '_blank'; button.rel = 'noopener noreferrer';
      button.setAttribute('aria-label', `${truckLabel(truck.truck)} · ${fresh ? 'Recent GPS' : 'Last Known Position'} · ${truck.lastGpsUpdate || 'Timestamp Unavailable'}`);
      const tooltip = document.createElement('span');
      tooltip.textContent = `${truckLabel(truck.truck)} · ${fresh ? 'Recent GPS' : 'Last Known Position'} · ${truck.lastGpsUpdate || 'Timestamp Unavailable'}`;
      L.marker(coordinate, { icon: L.divIcon({ className: 'live-map-pin', html: button, iconSize: [29, 29], iconAnchor: [0, 0] }), zIndexOffset: 500 }).bindTooltip(tooltip).addTo(layer);
    });
    const footprint = appointments.map(job => job.recordId).sort().join('|');
    if (bounds.length && fitted.current !== footprint) { view.fitBounds(bounds, { padding: [35, 45], maxZoom: 12 }); fitted.current = footprint; }
  }, [appointments, trucks, selected]);
  return <div ref={host} className="live-schedule-map" aria-label="Verified appointment locations and truck GPS" />;
}
