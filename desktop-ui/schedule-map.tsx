import { truckDisplayText } from '../lib/junkware-trucks';
import { dumpTruckMapSvg, truckMapOrientation } from './lib/truck-map-icon';
import { truckGpsStatus } from '../lib/truck-gps-status';
import { appointmentPartner } from '../lib/appointment-partner';
import { useEffect, useRef, useState } from 'react';
import { truckTelemetry } from './lib/truck-telemetry';
import './truck-telemetry.css';
import { leafletEngine, type MapEngine, type MapGroup, type MapView, type Coordinate } from './lib/map-engine';
import { appleMapEngine, loadAppleMapKit } from './lib/apple-mapkit';
import './apple-maps.css';
import 'leaflet/dist/leaflet.css';
import './appointment-presence.css';
import type { ScheduleAppointment, ScheduleTruck } from './lib/schedule-contract';
import { scheduleDisplayLocator, appointmentColorClass, appointmentStatus, scheduleDisplayTruck, scheduleStatusTone, truckLabel } from './lib/schedule-contract';
import { locatorSize, truckLocatorSize, territoryMapCenters } from './lib/schedule-map-layout';
import type {TruckGpsRoute} from './lib/gps-route-contract';
import {continuousGpsDisplayPaths,gpsTripColor,gpsTripDisplay,unassignedGpsColor} from './lib/gps-trip-display';

export type ScheduleMapProps = {
  mapEngine?: MapEngine; // Synthetic fixtures can inject an SDK without external requests.
  appointments: ScheduleAppointment[]; trucks: ScheduleTruck[];
  selected: string | null; selectedTruck: string | null;
  gpsRoute?:TruckGpsRoute|null;
  truckMapView?:'location'|'route'|'overview';
  selectedTripId?:string|null; onSelectTrip?:(id:string|null)=>void;
  scope: string; resetKey: number; date: string;
  onSelect: (id: string) => void; onSelectTruck: (truck: string, view?: 'location' | 'overview') => void;
};
export default function ScheduleMap(props: ScheduleMapProps) {
  const [configuredEngine, setConfiguredEngine] = useState<MapEngine | null>(null);
  const [appleFailed, setAppleFailed] = useState(false);
  const engine = props.mapEngine || configuredEngine;
  useEffect(() => {
    if (props.mapEngine) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    let active = true;
    const fallback = () => { if (active) { setAppleFailed(true); setConfiguredEngine(leafletEngine); } };
    fetch('/api/desktop/maps', { signal: controller.signal, cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(async config => {
        if (!active) return;
        if (config?.provider !== 'apple' || typeof config.token !== 'string' || !config.token) {
          setConfiguredEngine(leafletEngine);
          return;
        }
        try { const kit = await loadAppleMapKit(config.token); if (active) setConfiguredEngine(appleMapEngine(kit, fallback)); }
        catch { fallback(); }
      }).catch(() => { if (active) setConfiguredEngine(leafletEngine); }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [props.mapEngine]);
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapView | null>(null);
  const markers = useRef<MapGroup | null>(null);
  const gpsLayer=useRef<MapGroup|null>(null);
  const gpsFit=useRef('');
  const truckClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef(props);
  current.current = props;
  const fitted = useRef('');
  const focused = useRef('');
  const autoFit = useRef<(() => void) | null>(null);
  const manualViewport = useRef(false);
  const [following, setFollowing] = useState(true);
  useEffect(() => {
    setFollowing(Boolean(props.selectedTruck) && props.truckMapView !== 'route');
  }, [props.selectedTruck, props.resetKey, props.date, props.truckMapView]);
  useEffect(() => {
    if (!host.current || !engine) return;
    let view: MapView | undefined;
    try { view = engine.map(host.current, { zoomControl: true, scrollWheelZoom: true }); view.setView([30.14, -90.5], 8); }
    catch (error) { view?.remove(); if (engine.name !== 'apple') throw error; setAppleFailed(true); setConfiguredEngine(leafletEngine); return; }
    view.attributionControl.setPrefix(false);
    map.current = view;
    gpsLayer.current=engine.layerGroup().addTo(view);
    markers.current = engine.layerGroup().addTo(view);
    // The Schedule panel changes height after its first layout. Fit against
    // the final container size, but never undo a dispatcher's own pan/zoom.
    const stopAutoFit = (event?: { target?: unknown }) => {
      if (event?.target instanceof Element && event.target.closest('.truck-map-view-controls')) return;
      manualViewport.current = true;
      setFollowing(false);
    };
    const element = host.current;
    element.addEventListener('wheel', stopAutoFit, { passive: true, capture: true });
    element.addEventListener('keydown', stopAutoFit, true);
    element.addEventListener('pointerdown', stopAutoFit, true);
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
    return () => { if (truckClickTimer.current) clearTimeout(truckClickTimer.current); cancelAnimationFrame(frame); observer.disconnect(); element.removeEventListener('wheel', stopAutoFit, true); element.removeEventListener('keydown', stopAutoFit, true); element.removeEventListener('pointerdown', stopAutoFit, true); autoFit.current = null; view.remove(); for (const name of [...element.classList]) if (name.startsWith('leaflet-')) element.classList.remove(name); map.current = null; markers.current = null; gpsLayer.current=null;gpsFit.current='';fitted.current = ''; focused.current = ''; };
  }, [engine]);
  // Avoid rebuilding marker DOM on unrelated parent renders, preserving keyboard focus.
  const signature = JSON.stringify([props.trucks.map(truck => [truckGpsStatus(truck).label, truckTelemetry(truck).recent]), props.appointments, props.trucks, props.selected, props.selectedTruck, props.scope, props.resetKey, props.date, props.truckMapView, props.selectedTripId, props.gpsRoute?.trips]);
  useEffect(() => {
    const view = map.current;
    const layer = markers.current;
    if (!view || !layer || !engine) return;
    const { appointments, trucks, selected, selectedTruck, scope, resetKey, date } = current.current;
    type Pin = { id: string; coordinate: Coordinate; label: string; text: string; speed?: string; orientation?: ReturnType<typeof truckMapOrientation>; color?: string; partner?: string; tooltipTitle: string; tooltipDetail: string; className: string; area?: boolean; selected: boolean; select: () => void; zoom?: () => void };
    const pins: Pin[] = [];
    const appointmentBounds: Coordinate[] = [];
    appointments.forEach((job, index) => {
      const locator = scheduleDisplayLocator(job);
      const location = locator.location;
      const approximate = !job.location;
      const coordinate: Coordinate = [location.latitude, location.longitude];
      const assignmentClass = scheduleDisplayTruck(job) === 'Unassigned' ? 'assignment-unassigned' : 'assignment-assigned';
      appointmentBounds.push(coordinate);
      pins.push({ id: `appointment:${job.recordId}`, coordinate, area:locator.kind==='area',
        partner: appointmentPartner(job)?.short, tooltipTitle: `${job.jkNumber}${appointmentPartner(job) ? ` · ${appointmentPartner(job)!.name}` : ''}`, tooltipDetail: `${job.customerName} · ${job.appointmentTime}${locator.kind==='area' ? ` · ${locator.label}: ${locator.detail}` : approximate ? ` · Approximate: ${job.mapFallback?.matchedAddress}` : ''}`, text: scheduleStatusTone(job) === 'completed' ? '✓' : scheduleStatusTone(job) === 'canceled' ? '×' : String(index + 1), label: `Open appointment ${job.jkNumber}${locator.kind==='area' ? ", area locator, property not located" : approximate ? ", approximate location" : ""}, ${job.appointmentTime}, ${job.customerName}, ${appointmentStatus(job)}${appointmentPartner(job) ? `, ${appointmentPartner(job)!.name}` : ''}`,
        className: `appointment-marker ${locator.kind==='area' ? "area-locator" : ""} ${approximate ? "approximate-location" : ""} ${assignmentClass} status-${scheduleStatusTone(job)} ${appointmentColorClass(job)} ${appointmentStatus(job).toLowerCase().replaceAll(' ', '-')}`,
        selected: selected === job.recordId, select: () => current.current.onSelect(job.recordId) });
    });
    trucks.forEach(truck => {
      if (truck.latitude === null || truck.longitude === null) return;
      const name = truckLabel(truck.truck);
      const gps = truckGpsStatus(truck);
      const telemetry = truckTelemetry(truck);
      const fresh = !gps.stale;
      const orientation = truckMapOrientation(truck.heading);
      const headingLabel = orientation ? `${telemetry.recent ? 'Heading' : 'Last heading'} ${orientation.direction}` : 'Heading unavailable';
      pins.push({ id: `truck:${name}`, coordinate: [truck.latitude, truck.longitude], text: name.replace('Truck ', 'T'),
        speed: telemetry.markerLabel, orientation,
        tooltipTitle: truckDisplayText(name), tooltipDetail: `${gps.label} · ${telemetry.markerLabel} · ${headingLabel}`,
        label: `Select ${truckDisplayText(name)}, ${gps.label}, ${telemetry.markerLabel}, ${headingLabel}`,
        className: `truck-marker${fresh ? '' : ' stale'}`, selected: selectedTruck === name,
        select: () => current.current.onSelectTruck(name, 'overview'),
        zoom: () => current.current.onSelectTruck(name, 'location') });
    });
    if(current.current.truckMapView === 'route' && current.current.gpsRoute?.truck === selectedTruck) {
      for(const trip of current.current.gpsRoute.trips || []) {
        if(current.current.selectedTripId && current.current.selectedTripId !== trip.id) continue;
        for(const [endpoint,letter] of [[trip.from,'A'],[trip.to,'B']] as const) pins.push({
          id:`trip:${trip.id}:${letter}`,coordinate:[endpoint.latitude,endpoint.longitude],
          text:`${trip.number}${letter}`,label:`Show trip ${trip.number} ${letter==='A'?'start':'stop'}, ${endpoint.address}`,
          tooltipTitle:`Trip ${trip.number} · ${letter==='A'?'Start':'Stop'}`,tooltipDetail:endpoint.address,
          className:'trip-marker',color:gpsTripColor(trip.number),selected:current.current.selectedTripId===trip.id,select:()=>current.current.onSelectTrip?.(trip.id),
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
      // A refreshed appointment set must not replace the selected truck/job view.
      if (!selected && !selectedTruck) autoFit.current();
      fitted.current = fitKey;
    }
    const focusKey = selected ? `appointment:${selected}` : selectedTruck ? `truck:${selectedTruck}` : '';
    const focusVersion = `${focusKey}:${resetKey}:${selected ? JSON.stringify(pins.find(pin=>pin.id===focusKey)?.coordinate) : ''}`;
    if (focusKey && focused.current !== focusVersion && (selected || current.current.truckMapView !== 'route')) {
      const pin = pins.find(pin => pin.id === focusKey);
      if (pin) view.setView(pin.coordinate, selectedTruck ? (current.current.truckMapView === 'location' ? 19 : 15) : pin.area ? 10 : Math.max(view.getZoom(), 12), { animate: false });
    }
    focused.current = focusVersion;
    // Follow only received fixes. Never extrapolate motion between GPS reports.
    // Manual pan/zoom pauses following; the control explicitly resumes it.
    const tracked = trucks.find(truck => truckLabel(truck.truck) === selectedTruck);
    if (following && !selected && current.current.truckMapView !== 'route'
      && tracked?.latitude != null && tracked.longitude != null && truckTelemetry(tracked).recent) {
      view.panTo([tracked.latitude, tracked.longitude], { animate: false });
    }
    const render = () => {
      const activeId = host.current?.contains(document.activeElement) ? (document.activeElement as HTMLElement)?.dataset.mapPin : undefined;
      const viewport = view.getSize();
      const visiblePins = pins.map(pin => ({ pin, point: view.latLngToContainerPoint(pin.coordinate) }))
        .filter(({ point }) => point.x >= 0 && point.y >= 0 && point.x <= viewport.x && point.y <= viewport.y);
      layer.clearLayers();
      for (const { pin } of visiblePins) {
        const isTruck = pin.id.startsWith('truck:');
        const size = isTruck ? truckLocatorSize(view.getZoom()) : locatorSize(view.getZoom());
        const iconSize: Coordinate = [isTruck ? size * 1.5 + 8 : size + 12, size + 12];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `map-marker ${pin.className}${pin.selected ? ' route-selected' : ''}`;
        button.style.setProperty('--map-locator-size', `${size}px`);
        if(pin.color)button.style.setProperty('--trip-color',pin.color);
        button.style.setProperty('--map-locator-font', `${Math.round(size * .48)}px`);
        const symbol = document.createElement('span');
        symbol.className = 'map-pin-symbol';
        symbol.setAttribute('aria-hidden', 'true');
        if (pin.id.startsWith('truck:')) {
          // Static icon geometry; the truck number is inserted as text, never HTML.
          symbol.innerHTML = dumpTruckMapSvg;
          const number = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          const orientation = pin.orientation;
          const svg = symbol.querySelector('svg')!;
          const labelX = orientation?.mirrored ? 31 : 17;
          if (orientation) {
            svg.style.transform = `rotate(${orientation.rotation}deg)`;
            if (orientation.mirrored) svg.querySelector('.truck-shape')!.setAttribute('transform', 'translate(48 0) scale(-1 1)');
            number.setAttribute('transform', `rotate(${-orientation.rotation} ${labelX} 14)`);
            button.dataset.heading = String(orientation.bearing);
          }
          number.setAttribute('x', String(labelX));
          number.setAttribute('y', '19');
          number.setAttribute('text-anchor', 'middle');
          number.textContent = pin.text.replace(/^T/, '');
          symbol.querySelector('svg')!.append(number);
        } else symbol.textContent = pin.text;
        button.append(symbol);
        if(pin.area) {const badge=document.createElement('span');badge.className='truck-speed-badge';badge.textContent='Area';button.append(badge);}
        if (pin.speed) { const speed = document.createElement('span'); speed.className = 'truck-speed-badge'; speed.textContent = pin.speed; speed.setAttribute('aria-hidden', 'true'); button.append(speed); }
        if (pin.partner) { const badge = document.createElement('span'); badge.className = 'map-partner-badge'; badge.textContent = pin.partner; badge.setAttribute('aria-hidden', 'true'); button.append(badge); }
        button.dataset.mapPin = pin.id;
        button.setAttribute('aria-label', pin.label);
        button.setAttribute('aria-pressed', String(pin.selected));
        engine.DomEvent.disableClickPropagation(button);
        button.onclick = event => {
          event.stopPropagation(); view.closePopup();
          if (truckClickTimer.current) clearTimeout(truckClickTimer.current);
          // Keep the marker under the pointer until a mouse double-click can
          // finish. Keyboard activation remains immediate.
          if (pin.zoom && event.detail > 0) truckClickTimer.current = setTimeout(pin.select, 350);
          else pin.select();
        };
        if (pin.zoom) button.ondblclick = event => {
          event.preventDefault(); event.stopPropagation();
          if (truckClickTimer.current) clearTimeout(truckClickTimer.current);
          pin.zoom!();
        };
        const tooltip = document.createElement('span');
        const title = document.createElement('strong'); title.textContent = pin.tooltipTitle;
        const detail = document.createElement('small'); detail.textContent = pin.tooltipDetail;
        tooltip.append(title, detail);
        // Property/GPS icons stay on source coordinates; area-only badges may fan out on screen.
        const tooltipOffset = engine.point(0, -size / 2 - 6);
        const peers=pin.area ? pins.filter(other=>other.area && other.coordinate[0]===pin.coordinate[0] && other.coordinate[1]===pin.coordinate[1]).sort((a,b)=>a.id.localeCompare(b.id)) : [];
        const slot=peers.findIndex(other=>other.id===pin.id);
        const dx=peers.length>1 ? ((slot%5)-(Math.min(peers.length,5)-1)/2)*48 : 0;
        const dy=peers.length>1 ? Math.floor(slot/5)*48 : 0;
        const marker = engine.marker(pin.coordinate, { keyboard: false, icon: engine.divIcon({ className: 'live-map-pin', html: button, iconSize, iconAnchor: [iconSize[0] / 2-dx, iconSize[1] / 2-dy] }), zIndexOffset: pin.selected ? 1900 : 1000 }).bindTooltip(tooltip, { className: 'live-map-tooltip', direction: 'top', offset: tooltipOffset, opacity: 1, permanent: false }).addTo(layer);
        button.onfocus = () => marker.openTooltip();
        button.onblur = () => marker.closeTooltip();
        marker.on('tooltipopen', () => {
          const bubble = marker.getTooltip();
          const element = bubble?.getElement();
          const canvas = host.current;
          if (!bubble || !element || !canvas) return;
          bubble.options.offset = tooltipOffset;
          element.style.maxWidth = `${Math.max(80, Math.min(150, canvas.clientWidth - 16))}px`;
          bubble.update();
          const bounds = canvas.getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          const dx = Math.max(bounds.left + 6 - rect.left, Math.min(0, bounds.right - 6 - rect.right));
          const dy = Math.max(bounds.top + 6 - rect.top, Math.min(0, bounds.bottom - 6 - rect.bottom));
          bubble.options.offset = engine.point(tooltipOffset.x + dx, tooltipOffset.y + dy);
          bubble.update();
        });
        if (activeId === pin.id) button.focus({ preventScroll: true });
      }

    };
    render();
    view.on('zoomend moveend resize', render);
    return () => { view.off('zoomend moveend resize', render); };
  }, [signature, following, engine]);
  useEffect(()=>{
    const view=map.current,layer=gpsLayer.current,route=props.gpsRoute;
    if(!view || !layer || !engine) return;
    layer.clearLayers();
    if(!route || route.date!==props.date || route.truck!==props.selectedTruck || (!route.points.length && !route.trips?.length)) {gpsFit.current='';return;}
    const {paths,isolated,bounds}=gpsTripDisplay(route,props.selectedTripId);
    // Paint all casings first, then continuous trip colors. Sparse GPS links
    // remain explicitly estimated in the tooltip and summary.
    const continuous=continuousGpsDisplayPaths(paths);
    for(const casing of [true,false])for(const path of continuous) {
      const line=engine.polyline(path.points.map(point=>[point.latitude,point.longitude] as Coordinate),{
        color:casing?'#fff':path.color,weight:casing?9:5,opacity:1,
        lineCap:'round',lineJoin:'round',interactive:!casing,
        className:casing?'schedule-gps-route-casing':'schedule-gps-trail'
      }).addTo(layer);
      if(!casing) {
        const label=document.createElement('span');
        const source=path.kind==='matched'?'Road-aligned GPS':path.kind==='estimated'?'Estimated road connection':path.kind==='gap'?'Estimated connection across sparse GPS reports':'Recorded GPS connection · street path unverified';
        label.textContent=`${path.trip?`Trip ${path.trip.number}`:'GPS outside recorded trips'} · ${source}`;
        line.bindTooltip(label,{sticky:true});
        if(path.trip)line.on('click',()=>current.current.onSelectTrip?.(path.trip!.id));
      }
    }
    // Keep isolated fixes visible without white dots breaking up solid lines.
    for(const point of isolated) engine.circleMarker([point.latitude,point.longitude],{radius:3,color:'#fff',fillColor:unassignedGpsColor,fillOpacity:1,weight:1,interactive:false,className:'schedule-gps-point'}).addTo(layer);
    const fitKey=`${route.date}:${route.truck}:${props.resetKey}:${props.truckMapView || 'location'}:${props.selectedTripId || ''}`;
    if(gpsFit.current!==fitKey) {
      if(props.truckMapView==='overview') {
        const truck=props.trucks.find(truck=>truckLabel(truck.truck)===route.truck && truck.latitude!=null && truck.longitude!=null);
        // Live selection already centered the truck. Loading its history paints
        // the trail without replacing that view or a subsequent manual pan.
        const latest=!truck && (route.points.at(-1) || route.trips?.at(-1)?.to);
        if(latest && !manualViewport.current) view.setView([latest.latitude,latest.longitude],15,{animate:false});
      }
      else if(props.truckMapView==='route') {
        if(bounds.length) view.fitBounds(bounds.map(point=>[point.latitude,point.longitude] as Coordinate),{padding:[45,45],maxZoom:15,animate:false});
      }
      else if(!props.trucks.some(truck=>truckLabel(truck.truck)===route.truck && truck.latitude!=null && truck.longitude!=null)) {
        // Historical days have no current truck marker. Focus the last recorded
        // position for that day without letting history override today's marker.
        const latest=route.points.at(-1) || route.trips?.at(-1)?.to;
        if(latest) view.setView([latest.latitude,latest.longitude],19,{animate:false});
      }
      gpsFit.current=fitKey;
    }
    return()=>{layer.clearLayers();};
  },[props.gpsRoute,props.selectedTruck,props.date,props.resetKey,props.truckMapView,props.trucks,props.selectedTripId,engine]);
  const canFollow = props.selectedTruck && !props.selected
    && props.trucks.some(truck => truckLabel(truck.truck) === props.selectedTruck && truck.latitude != null && truck.longitude != null);
  const viewingRoutes = props.truckMapView === 'route';
  return <div ref={host} data-gesture-ignore data-map-provider={engine?.name || 'loading'} aria-busy={!engine} className="live-schedule-map" aria-label="Appointment map locations and truck GPS">
    {!engine && <span className="map-provider-status" role="status">Loading map…</span>}
    {appleFailed && <span className="map-provider-status" role="status">Apple Maps unavailable · OpenStreetMap</span>}
    {props.selectedTruck && !props.selected && <div className="truck-map-view-controls" role="group" aria-label={`${truckDisplayText(props.selectedTruck)} map view`}>
      {canFollow && <button type="button" className="truck-follow-control" aria-pressed={!viewingRoutes && following}
        onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()} onClick={event => {
          event.stopPropagation();
          if(viewingRoutes) current.current.onSelectTruck(props.selectedTruck!, 'overview');
          else setFollowing(value => !value);
        }}
        title="Keep the selected truck centered as GPS reports arrive. Pan or zoom to pause.">
        {!viewingRoutes && following ? 'Following' : 'Follow'} {props.selectedTruck}
      </button>}
      <button type="button" className="truck-routes-control" aria-pressed={viewingRoutes}
        onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); current.current.onSelectTrip?.(null); }}
        title={`Fit the map to every recorded route for ${truckDisplayText(props.selectedTruck)} so far today.`}>
        View Routes
      </button>
    </div>}
  </div>;
}
