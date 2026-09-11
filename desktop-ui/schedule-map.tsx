import { dumpTruckMapSvg } from './lib/truck-map-icon';
import { truckGpsStatus } from '../lib/truck-gps-status';
import { appointmentPartner } from '../lib/appointment-partner';
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './appointment-presence.css';
import type { ScheduleAppointment, ScheduleTruck } from './lib/schedule-contract';
import { appointmentColorClass, appointmentStatus, scheduleStatusTone, truckLabel } from './lib/schedule-contract';
import { territoryMapCenters } from './lib/schedule-map-layout';
import type {TruckGpsRoute} from './lib/gps-route-contract';

type Props = {
  appointments: ScheduleAppointment[]; trucks: ScheduleTruck[];
  selected: string | null; selectedTruck: string | null;
  gpsRoute?:TruckGpsRoute|null;
  truckMapView?:'location'|'route';
  selectedTripId?:string|null; onSelectTrip?:(id:string)=>void;
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
  const autoFit = useRef<(() => void) | null>(null);
  const manualViewport = useRef(false);
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
    // The Schedule panel changes height after its first layout. Fit against
    // the final container size, but never undo a dispatcher's own pan/zoom.
    const stopAutoFit = () => { manualViewport.current = true; };
    const element = host.current;
    element.addEventListener('wheel', stopAutoFit, { passive: true });
    element.addEventListener('keydown', stopAutoFit);
    element.addEventListener('pointerdown', stopAutoFit);
    view.on('dragstart', stopAutoFit);
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        view.invalidateSize({ pan: false });
        if (!manualViewport.current && !current.current.selected && !current.current.selectedTruck) autoFit.current?.();
      });
    });
    observer.observe(host.current);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); element.removeEventListener('wheel', stopAutoFit); element.removeEventListener('keydown', stopAutoFit); element.removeEventListener('pointerdown', stopAutoFit); autoFit.current = null; view.remove(); map.current = null; markers.current = null; gpsLayer.current=null;gpsFit.current='';fitted.current = ''; focused.current = ''; };
  }, []);
  // Avoid rebuilding marker DOM on unrelated parent renders, preserving keyboard focus.
  const signature = JSON.stringify([props.trucks.map(truck => truckGpsStatus(truck).label), props.appointments, props.trucks, props.selected, props.selectedTruck, props.scope, props.resetKey, props.date, props.truckMapView, props.selectedTripId, props.gpsRoute?.trips]);
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
        className: `appointment-marker status-${scheduleStatusTone(job)} ${appointmentColorClass(job)} ${appointmentStatus(job).toLowerCase().replaceAll(' ', '-')}`,
        selected: selected === job.recordId, select: () => current.current.onSelect(job.recordId) });
    });
    trucks.forEach(truck => {
      if (truck.latitude === null || truck.longitude === null) return;
      const name = truckLabel(truck.truck);
      const gps = truckGpsStatus(truck);
      const fresh = !gps.stale;
      pins.push({ id: `truck:${name}`, coordinate: [truck.latitude, truck.longitude], text: name.replace('Truck ', 'T'),
        tooltipTitle: name, tooltipDetail: gps.label,
        label: `Select ${name}, ${gps.label}`,
        className: `truck-marker${fresh ? '' : ' stale'}`, selected: selectedTruck === name,
        select: () => current.current.onSelectTruck(name) });
    });
    if(current.current.truckMapView === 'route' && current.current.gpsRoute?.truck === selectedTruck) {
      for(const trip of current.current.gpsRoute.trips || []) {
        if(current.current.selectedTripId && current.current.selectedTripId !== trip.id) continue;
        for(const [endpoint,letter] of [[trip.from,'A'],[trip.to,'B']] as const) pins.push({
          id:`trip:${trip.id}:${letter}`,coordinate:[endpoint.latitude,endpoint.longitude],
          text:`${trip.number}${letter}`,label:`Show trip ${trip.number} ${letter==='A'?'start':'stop'}, ${endpoint.address}`,
          tooltipTitle:`Trip ${trip.number} · ${letter==='A'?'Start':'Stop'}`,tooltipDetail:endpoint.address,
          className:'trip-marker',selected:false,select:()=>current.current.onSelectTrip?.(trip.id),
        });
      }
    }
    const fitKey = `${date}:${scope}:${resetKey}:${appointments.map(job => job.recordId).sort().join('|')}`;
    autoFit.current = () => {
      const bounds = scope === 'ALL' ? pins.filter(pin => !pin.id.startsWith('trip:')).map(pin => pin.coordinate) : appointmentBounds;
      if (bounds.length) view.fitBounds(bounds, { padding: [28, 28], maxZoom: 12, animate: false });
      else if (territoryMapCenters[scope.split(':')[0]]) view.setView(territoryMapCenters[scope.split(':')[0]], 11, { animate: false });
      else view.setView([30.14, -90.5], 8, { animate: false });
    };
    if (fitted.current !== fitKey) {
      view.closePopup();
      manualViewport.current = false;
      view.invalidateSize({ pan: false });
      autoFit.current();
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
      for (const pin of pins) {
        // Keep the center of every icon on the source coordinate at every zoom.
        const iconSize: L.PointTuple = pin.id.startsWith('truck:') ? [26, 20] : pin.id.startsWith('trip:') ? [42, 34] : [16, 16];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `map-marker ${pin.className}${pin.selected ? ' route-selected' : ''}`;
        const symbol = document.createElement('span');
        symbol.className = 'map-pin-symbol';
        symbol.setAttribute('aria-hidden', 'true');
        if (pin.id.startsWith('truck:')) {
          // Static icon geometry; the truck number is inserted as text, never HTML.
          symbol.innerHTML = dumpTruckMapSvg;
          const number = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          number.setAttribute('x', '17');
          number.setAttribute('y', '18');
          number.setAttribute('text-anchor', 'middle');
          number.textContent = pin.text.replace(/^T/, '');
          symbol.querySelector('svg')!.append(number);
        } else symbol.textContent = pin.text;
        button.append(symbol);
        if (pin.partner) { const badge = document.createElement('span'); badge.className = 'map-partner-badge'; badge.textContent = pin.partner; badge.setAttribute('aria-hidden', 'true'); button.append(badge); }
        button.dataset.mapPin = pin.id;
        button.setAttribute('aria-label', pin.label);
        button.setAttribute('aria-pressed', String(pin.selected));
        L.DomEvent.disableClickPropagation(button);
        button.onclick = event => { event.stopPropagation(); view.closePopup(); pin.select(); };
        const tooltip = document.createElement('span');
        const title = document.createElement('strong'); title.textContent = pin.tooltipTitle;
        const detail = document.createElement('small'); detail.textContent = pin.tooltipDetail;
        tooltip.append(title, detail);
        const marker = L.marker(pin.coordinate, { keyboard: false, icon: L.divIcon({ className: 'live-map-pin', html: button, iconSize, iconAnchor: [iconSize[0] / 2, iconSize[1] / 2] }), zIndexOffset: pin.selected ? 1900 : 1000 }).bindTooltip(tooltip, { className: 'live-map-tooltip', direction: 'top', offset: L.point(0, -10), opacity: 1, permanent: false }).addTo(layer);
        button.onfocus = () => marker.openTooltip();
        button.onblur = () => marker.closeTooltip();
        marker.on('tooltipopen', () => {
          const bubble = marker.getTooltip();
          const element = bubble?.getElement();
          const canvas = host.current;
          if (!bubble || !element || !canvas) return;
          bubble.options.offset = L.point(0, -10);
          element.style.maxWidth = `${Math.max(80, Math.min(150, canvas.clientWidth - 16))}px`;
          bubble.update();
          const bounds = canvas.getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          const dx = Math.max(bounds.left + 6 - rect.left, Math.min(0, bounds.right - 6 - rect.right));
          const dy = Math.max(bounds.top + 6 - rect.top, Math.min(0, bounds.bottom - 6 - rect.bottom));
          bubble.options.offset = L.point(dx, -10 + dy);
          bubble.update();
        });
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
    if(!route || route.date!==props.date || route.truck!==props.selectedTruck || (!route.points.length && !route.trips?.length)) {gpsFit.current='';return;}
    // Only road geometry gets connecting lines. Provider outages never restore
    // straight chords through blocks; source dots remain at their exact fixes.
    const streetPaths=route.streets?.sourceVersion===route.sourceVersion?route.streets?.paths || []:[];
    // Paint every white casing first so adjacent segments do not cover each
    // other's color. Estimated sections keep their dashed road geometry.
    for(const casing of [true,false])for(const path of streetPaths) {
      const estimated=path.kind==='estimated';
      L.polyline(path.points.map(point=>[point.latitude,point.longitude] as L.LatLngTuple),{
        color:casing?'#fff':estimated?'#b45309':'#174fd1',weight:casing?9:5,opacity:1,
        lineCap:'round',lineJoin:'round',dashArray:estimated?'12 10':undefined,interactive:false,
        className:casing?'schedule-gps-route-casing':estimated?'schedule-gps-gap-link':'schedule-gps-trail'
      }).addTo(layer);
    }
    // Isolated observations stay visible without inventing a connecting route.
    for(const point of route.points) L.circleMarker([point.latitude,point.longitude],{radius:streetPaths.length?1.75:3,color:'#fff',fillColor:'#174fd1',fillOpacity:1,weight:streetPaths.length?.75:1,interactive:false,className:'schedule-gps-point'}).addTo(layer);
    const fitKey=`${route.date}:${route.truck}:${props.resetKey}:${props.truckMapView || 'location'}:${props.selectedTripId || ''}`;
    if(gpsFit.current!==fitKey) {
      if(props.truckMapView==='route') {
        const trip=route.trips?.find(trip=>trip.id===props.selectedTripId);
        const points=trip?[trip.from,...route.points.filter(p=>p.timestamp>=trip.departure && p.timestamp<=trip.arrival),trip.to]:route.trips?.length?route.trips.flatMap(trip=>[trip.from,trip.to]):route.points;
        if(points.length) view.fitBounds(points.map(point=>[point.latitude,point.longitude] as L.LatLngTuple),{padding:[45,45],maxZoom:15,animate:false});
      }
      else if(!props.trucks.some(truck=>truckLabel(truck.truck)===route.truck && truck.latitude!=null && truck.longitude!=null)) {
        // Historical days have no current truck marker. Focus the last recorded
        // position for that day without letting history override today's marker.
        const latest=route.points.at(-1)!;
        view.setView([latest.latitude,latest.longitude],Math.max(view.getZoom(),15),{animate:false});
      }
      gpsFit.current=fitKey;
    }
    return()=>{layer.clearLayers();};
  },[props.gpsRoute,props.selectedTruck,props.date,props.resetKey,props.truckMapView,props.trucks,props.selectedTripId]);
  return <div ref={host} className="live-schedule-map" aria-label="Verified appointment locations and truck GPS" />;
}
