import { appointmentPartner } from '../lib/appointment-partner';
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './appointment-presence.css';
import type { ScheduleAppointment, ScheduleTruck } from './lib/schedule-contract';
import { appointmentRegion, appointmentStatus, scheduleStatusTone, truckLabel } from './lib/schedule-contract';
import { nearbyMapPins, territoryMapCenters } from './lib/schedule-map-layout';
import type {TruckGpsRoute} from './lib/gps-route-contract';

type Props = {
  appointments: ScheduleAppointment[]; trucks: ScheduleTruck[];
  selected: string | null; selectedTruck: string | null;
  gpsRoute?:TruckGpsRoute|null;
  truckMapView?:'location'|'route';
  scope: string; resetKey: number; date: string;
  onSelect: (id: string) => void; onSelectTruck: (truck: string) => void;
};
export default function ScheduleMap(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const gpsLayer=useRef<L.LayerGroup|null>(null);
  const gpsFit=useRef('');
  const current = useRef(props);
  current.current = props;
  const fitted = useRef('');
  const focused = useRef('');
  useEffect(() => {
    if (!host.current) return;
    const view = L.map(host.current, { zoomControl: true, scrollWheelZoom: true }).setView([30.14, -90.5], 8);
    view.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 20, maxNativeZoom: 19, updateWhenIdle: true, keepBuffer: 1,
    }).addTo(view);
    map.current = view;
    gpsLayer.current=L.layerGroup().addTo(view);
    markers.current = L.layerGroup().addTo(view);
    const observer = new ResizeObserver(() => view.invalidateSize());
    observer.observe(host.current);
    return () => { observer.disconnect(); view.remove(); map.current = null; markers.current = null; gpsLayer.current=null;gpsFit.current='';fitted.current = ''; focused.current = ''; };
  }, []);
  // Avoid rebuilding marker DOM on unrelated parent renders, preserving keyboard focus.
  const signature = JSON.stringify([props.appointments, props.trucks, props.selected, props.selectedTruck, props.scope, props.resetKey, props.date, props.truckMapView]);
  useEffect(() => {
    const view = map.current;
    const layer = markers.current;
    if (!view || !layer) return;
    const { appointments, trucks, selected, selectedTruck, scope, resetKey, date } = current.current;
    type Pin = { id: string; coordinate: L.LatLngTuple; label: string; text: string; partner?: string; tooltipTitle: string; tooltipDetail: string; className: string; selected: boolean; select: () => void };
    const pins: Pin[] = [];
    const appointmentBounds: L.LatLngTuple[] = [];
    appointments.forEach((job, index) => {
      if (!job.location) return;
      const coordinate: L.LatLngTuple = [job.location.latitude, job.location.longitude];
      appointmentBounds.push(coordinate);
      pins.push({ id: `appointment:${job.recordId}`, coordinate,
        partner: appointmentPartner(job)?.short, tooltipTitle: `${job.jkNumber}${appointmentPartner(job) ? ` · ${appointmentPartner(job)!.name}` : ''}`, tooltipDetail: `${job.customerName} · ${job.appointmentTime}`, text: scheduleStatusTone(job) === 'completed' ? '✓' : scheduleStatusTone(job) === 'canceled' ? '×' : String(index + 1), label: `Open appointment ${job.jkNumber}, ${job.appointmentTime}, ${job.customerName}, ${appointmentStatus(job)}${appointmentPartner(job) ? `, ${appointmentPartner(job)!.name}` : ''}`,
        className: `appointment-marker status-${scheduleStatusTone(job)} territory-${appointmentRegion(job).code.toLowerCase()} ${appointmentStatus(job).toLowerCase().replaceAll(' ', '-')}`,
        selected: selected === job.recordId, select: () => current.current.onSelect(job.recordId) });
    });
    trucks.forEach(truck => {
      if (truck.latitude === null || truck.longitude === null) return;
      const name = truckLabel(truck.truck);
      const age = Date.now() - Date.parse(truck.lastGpsUpdate || '');
      const fresh = Number.isFinite(age) && age >= 0 && age <= 180_000;
      pins.push({ id: `truck:${name}`, coordinate: [truck.latitude, truck.longitude], text: name.replace('Truck ', 'T'),
        tooltipTitle: name, tooltipDetail: fresh ? 'Recent GPS' : 'Last known GPS',
        label: `Select ${name}, ${fresh ? 'Recent GPS' : 'Last Known Position'}`,
        className: `truck-marker${fresh ? '' : ' stale'}`, selected: selectedTruck === name,
        select: () => current.current.onSelectTruck(name) });
    });
    const fitKey = `${date}:${scope}:${resetKey}:${appointments.map(job => job.recordId).sort().join('|')}`;
    if (fitted.current !== fitKey) {
      view.closePopup();
      const bounds = scope === 'ALL' ? pins.map(pin => pin.coordinate) : appointmentBounds;
      if (bounds.length) view.fitBounds(bounds, { padding: [65, 65], maxZoom: 12, animate: false });
      else if (territoryMapCenters[scope.split(':')[0]]) view.setView(territoryMapCenters[scope.split(':')[0]], 11, { animate: false });
      else view.setView([30.14, -90.5], 8, { animate: false });
      fitted.current = fitKey;
    }
    const focusKey = selected ? `appointment:${selected}` : selectedTruck ? `truck:${selectedTruck}` : '';
    const focusVersion = `${focusKey}:${resetKey}`;
    if (focusKey && focused.current !== focusVersion && (selected || current.current.truckMapView !== 'route')) {
      const pin = pins.find(pin => pin.id === focusKey);
      if (pin) view.setView(pin.coordinate, Math.max(view.getZoom(), selectedTruck ? 15 : 12), { animate: false });
    }
    focused.current = focusVersion;
    const render = () => {
      const activeId = host.current?.contains(document.activeElement) ? (document.activeElement as HTMLElement)?.dataset.mapPin : undefined;
      layer.clearLayers();
      const points = pins.map(pin => ({ id: pin.id, ...view.latLngToLayerPoint(pin.coordinate) }));
      for (const pin of pins) {
        const nearbyIds = new Set(nearbyMapPins(points, pin.id).map(point => point.id));
        const nearby = pins.filter(candidate => nearbyIds.has(candidate.id));
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `map-marker ${pin.className}${pin.selected ? ' route-selected' : ''}`;
        const symbol = document.createElement('span');
        symbol.className = 'map-pin-symbol';
        symbol.setAttribute('aria-hidden', 'true');
        if (pin.id.startsWith('truck:')) {
          // Static icon geometry; the truck number is inserted as text, never HTML.
          symbol.innerHTML = '<svg viewBox="0 0 28 24" focusable="false"><rect x="1" y="3" width="15" height="14" rx="2"/><path d="M16 8h5l5 5v4H16z"/><path class="truck-window" d="M18 10h2l3 3h-5z"/><circle cx="6" cy="18" r="3"/><circle cx="21" cy="18" r="3"/></svg>';
          const number = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          number.setAttribute('x', '8.5');
          number.setAttribute('y', '13.5');
          number.setAttribute('text-anchor', 'middle');
          number.textContent = pin.text.replace(/^T/, '');
          symbol.querySelector('svg')!.append(number);
        } else symbol.textContent = pin.text;
        button.append(symbol);
        if (pin.partner) { const badge = document.createElement('span'); badge.className = 'map-partner-badge'; badge.textContent = pin.partner; badge.setAttribute('aria-hidden', 'true'); button.append(badge); }
        button.dataset.mapPin = pin.id;
        button.setAttribute('aria-label', `${pin.label}${nearby.length > 1 ? `, ${nearby.length} nearby locators` : ''}`);
        button.setAttribute('aria-pressed', String(pin.selected));
        L.DomEvent.disableClickPropagation(button);
        if (nearby.length > 1) {
          button.setAttribute('aria-haspopup', 'true');
        }
        button.onclick = event => {
          event.stopPropagation();
          if (nearby.length === 1) { view.closePopup(); pin.select(); return; }
          const choices = document.createElement('div');
          choices.className = 'map-locator-choices';
          choices.style.maxHeight = `${Math.max(80, Math.min(180, (host.current?.clientHeight || 260) - 80))}px`;
          choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', 'Nearby locators');
          const heading = document.createElement('strong'); heading.textContent = `${nearby.length} nearby locators`;
          choices.append(heading);
          for (const candidate of nearby) {
            const choice = document.createElement('button'); choice.type = 'button';
            choice.setAttribute('aria-label', candidate.label);
            const title = document.createElement('strong'); title.textContent = candidate.tooltipTitle;
            const detail = document.createElement('small'); detail.textContent = candidate.tooltipDetail;
            choice.append(title, detail);
            choice.onclick = event => { event.stopPropagation(); view.closePopup(); candidate.select(); };
            choices.append(choice);
          }
          L.DomEvent.disableClickPropagation(choices);
          L.DomEvent.disableScrollPropagation(choices);
          L.popup({ className: 'map-locator-popup', autoPan: true, autoPanPadding: L.point(12, 12), maxWidth: 240 })
            .setLatLng(pin.coordinate).setContent(choices).openOn(view);
          choices.querySelector('button')?.focus({ preventScroll: true });
        };
        const tooltip = document.createElement('span');
        const title = document.createElement('strong'); title.textContent = pin.tooltipTitle;
        const detail = document.createElement('small'); detail.textContent = pin.tooltipDetail;
        tooltip.append(title, detail);
        const marker = L.marker(pin.coordinate, { keyboard: false, icon: L.divIcon({ className: 'live-map-pin', html: button, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: pin.selected ? 900 : 0 }).bindTooltip(tooltip, { className: 'live-map-tooltip', direction: 'top', offset: L.point(0, -12), opacity: 1, permanent: pin.selected }).addTo(layer);
        button.onfocus = () => marker.openTooltip();
        button.onblur = () => { if (!pin.selected) marker.closeTooltip(); };
        marker.on('tooltipopen', () => {
          const bubble = marker.getTooltip();
          const element = bubble?.getElement();
          const canvas = host.current;
          if (!bubble || !element || !canvas) return;
          bubble.options.offset = L.point(0, -12);
          element.style.maxWidth = `${Math.max(80, Math.min(150, canvas.clientWidth - 16))}px`;
          bubble.update();
          const bounds = canvas.getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          const dx = Math.max(bounds.left + 6 - rect.left, Math.min(0, bounds.right - 6 - rect.right));
          const dy = Math.max(bounds.top + 6 - rect.top, Math.min(0, bounds.bottom - 6 - rect.bottom));
          bubble.options.offset = L.point(dx, -12 + dy);
          bubble.update();
        });
        if (pin.selected) marker.openTooltip();
        if (activeId === pin.id) button.focus({ preventScroll: true });
      }
    };
    render();
    view.on('zoomend moveend', render);
    return () => { view.off('zoomend moveend', render); };
  }, [signature]);
  useEffect(()=>{
    const view=map.current,layer=gpsLayer.current,route=props.gpsRoute;
    if(!view || !layer) return;
    layer.clearLayers();
    if(!route || route.date!==props.date || route.truck!==props.selectedTruck || !route.points.length) {gpsFit.current='';return;}
    // Only road geometry gets connecting lines. Provider outages never restore
    // straight chords through blocks; source dots remain at their exact fixes.
    if(route.streets && route.streets.sourceVersion===route.sourceVersion)for(const path of route.streets.paths) {
      L.polyline(path.points.map(point=>[point.latitude,point.longitude] as L.LatLngTuple),{color:'#2563a5',weight:3,opacity:.9,dashArray:path.kind==='estimated'?'6 7':undefined,interactive:false,className:path.kind==='estimated'?'schedule-gps-gap-link':'schedule-gps-trail'}).addTo(layer);
    }
    // Isolated observations stay visible without inventing a connecting route.
    for(const point of route.points) L.circleMarker([point.latitude,point.longitude],{radius:3,color:'#fff',fillColor:'#2563a5',fillOpacity:1,weight:1,interactive:false,className:'schedule-gps-point'}).addTo(layer);
    const endpoints=route.points.length===1?[[route.points[0],'Recorded position'] as const]:[[route.points[0],'First'] as const,[route.points.at(-1)!,'Last'] as const];
    for(const [point,label] of endpoints) {
      const text=document.createElement('span');text.textContent=label;
      const tooltip=document.createElement('span');tooltip.textContent=`${label} GPS · ${new Date(point.timestamp).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})}`;
      // Routes commonly return to the same yard. Keep both endpoint labels
      // readable even when first and last positions overlap.
      L.marker([point.latitude,point.longitude],{keyboard:false,icon:L.divIcon({className:'schedule-gps-endpoint',html:text,iconSize:[40,22],iconAnchor:[20,label==='Last'?-3:25]}),zIndexOffset:500}).bindTooltip(tooltip).addTo(layer);
    }
    const fitKey=`${route.date}:${route.truck}:${props.resetKey}:${props.truckMapView || 'location'}`;
    if(gpsFit.current!==fitKey) {
      if(props.truckMapView==='route') view.fitBounds(route.points.map(point=>[point.latitude,point.longitude] as L.LatLngTuple),{padding:[45,45],maxZoom:15,animate:false});
      else if(!props.trucks.some(truck=>truckLabel(truck.truck)===route.truck && truck.latitude!=null && truck.longitude!=null)) {
        // Historical days have no current truck marker. Focus the last recorded
        // position for that day without letting history override today's marker.
        const latest=route.points.at(-1)!;
        view.setView([latest.latitude,latest.longitude],Math.max(view.getZoom(),15),{animate:false});
      }
      gpsFit.current=fitKey;
    }
    return()=>{layer.clearLayers();};
  },[props.gpsRoute,props.selectedTruck,props.date,props.resetKey,props.truckMapView,props.trucks]);
  return <div ref={host} className="live-schedule-map" aria-label="Verified appointment locations and truck GPS" />;
}
