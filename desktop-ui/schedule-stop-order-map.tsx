import {useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {appointmentServiceAddress} from '../lib/service-address-format';
import type {ScheduleAppointment,ScheduleRouteLeg,ScheduleSnapshot} from './lib/schedule-contract';
import {truckDisplayLabel} from '../lib/junkware-trucks';
import {stopOrderMap,stopOrderTrucks,stopOrderTruckBadges} from './lib/stop-order-map';

export default function ScheduleStopOrderMap({jobs,legs,fleet,selectedTruck,selected,onSelect,loading,stale}:{jobs:ScheduleAppointment[];legs:ScheduleRouteLeg[];fleet:ScheduleSnapshot['fleet'];selectedTruck:string;selected:string|null;onSelect:(id:string)=>void;loading:boolean;stale:boolean}) {
 const host=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null);
 const current=useRef({onSelect});current.current={onSelect};
 const fit=useRef<(allTrucks?:boolean)=>void>(()=>{}),fitted=useRef(''),focused=useRef<string|null>(null);
 const manualView=useRef(false),routed=useRef('');
 const model=stopOrderMap(jobs,stale||loading?[]:legs);
 const trucks=stopOrderTrucks(fleet,selectedTruck),activeTruck=trucks.find(truck=>truck.selected);
 const markerSignature=JSON.stringify([model,trucks,selected,selectedTruck]);
 useEffect(()=>{
  if(!host.current)return;
  const view=L.map(host.current,{scrollWheelZoom:true}).setView([30.15,-90.5],8);
  view.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',maxZoom:20,maxNativeZoom:19,updateWhenIdle:true,keepBuffer:1}).addTo(view);
  map.current=view;layer.current=L.layerGroup().addTo(view);
  const element=host.current,pauseFit=()=>{manualView.current=true;};
  element.addEventListener('pointerdown',pauseFit);element.addEventListener('wheel',pauseFit,{passive:true});
  const observer=new ResizeObserver(()=>view.invalidateSize({pan:false}));observer.observe(host.current);
  return()=>{observer.disconnect();element.removeEventListener('pointerdown',pauseFit);element.removeEventListener('wheel',pauseFit);view.remove();map.current=null;layer.current=null;};
 },[]);
 useEffect(()=>{
  const view=map.current,overlay=layer.current;if(!view||!overlay)return;
  overlay.clearLayers();
  const colors=['#245fa4','#8c3daa','#087f73','#b7611b'];
  for(const path of model.paths){
   const line=L.polyline(path.points.map(p=>[p.latitude,p.longitude] as [number,number]),{color:colors[(path.from-1)%colors.length],weight:5,opacity:.85}).addTo(overlay);
   const caption=document.createElement('span');caption.textContent=`${path.from} → ${path.to}${path.leg.travelMinutes===null?'':` · ${path.leg.travelMinutes} min · ${path.leg.miles} mi`}`;line.bindTooltip(caption,{sticky:true});
  }
  // Offset colocated pin badges so each remains selectable; locations stay exact.
  const seen=new Map<string,number>();
  for(const stop of model.stops){
   const position=`${stop.point.latitude}:${stop.point.longitude}`,offset=seen.get(position)||0;seen.set(position,offset+1);
   const marker=L.marker([stop.point.latitude,stop.point.longitude],{icon:L.divIcon({className:`stop-order-pin${selected===stop.job.recordId?' selected':''}`,html:`<span>${stop.number}</span>`,iconSize:[30,30],iconAnchor:[15-offset*22,15]}),title:`Stop ${stop.number}: ${stop.job.customerName} · ${stop.job.jkNumber}`,keyboard:true,zIndexOffset:selected===stop.job.recordId?1000:100}).addTo(overlay);
   const caption=document.createElement('div');caption.textContent=`${stop.number}. ${stop.job.customerName} · ${appointmentServiceAddress(stop.job)}`;marker.bindTooltip(caption);marker.on('click',()=>current.current.onSelect(stop.job.recordId));
  }
  const truckOverlay=L.layerGroup().addTo(overlay);
  const renderedTrucks=new Map<string,{marker:L.Marker;leader:L.Polyline;dot:L.CircleMarker}>();
  const placeTrucks=()=>{
   const bounds=view.getContainer().getBoundingClientRect();
   const blocked=Array.from(view.getContainer().querySelectorAll('.leaflet-control')).map(control=>{const r=control.getBoundingClientRect();return {left:r.left-bounds.left,top:r.top-bounds.top,width:r.width,height:r.height};});
   const badges=stopOrderTruckBadges(trucks.map(truck=>{
    const point=view.latLngToContainerPoint([truck.point.latitude,truck.point.longitude]);
    return {id:truck.label,x:point.x,y:point.y,selected:truck.selected,stale:truck.gps.stale};
   }),view.getSize(),blocked);
   for(const truck of trucks){
   const placement=badges.find(badge=>badge.id===truck.label)!;
   const badge=document.createElement('div');badge.className='stop-order-truck-badge';
   const name=document.createElement('strong');
   // Static truck glyph; source-provided labels are always plain text.
   name.innerHTML='<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 3h14v13H1zM15 8h4l4 4v4h-8"/><circle cx="5.5" cy="18" r="2.5"/><circle cx="18.5" cy="18" r="2.5"/></svg>';
   name.append(document.createTextNode(truck.label));badge.append(name);
   if(truck.gps.stale){const status=document.createElement('small');status.textContent='Last known';badge.append(status);}
   const description=`${truck.label} · ${truck.gps.label} · GPS ${truck.reportedAt}`;
   const icon=L.divIcon({className:`stop-order-truck${truck.selected?' selected':''}${truck.gps.stale?' stale':''}`,html:badge,iconSize:[placement.width,placement.height],iconAnchor:[placement.x-placement.left,placement.y-placement.top]});
   const existing=renderedTrucks.get(truck.label);
   const marker=existing?existing.marker.setIcon(icon):L.marker([truck.point.latitude,truck.point.longitude],{icon,title:description,alt:description,keyboard:true,zIndexOffset:truck.selected?100000:1200}).addTo(truckOverlay);
   const caption=document.createElement('div');caption.textContent=description;if(!existing)marker.bindPopup(caption);marker.bindTooltip(()=>caption.cloneNode(true) as HTMLElement,{direction:'top',offset:[placement.left+47-placement.x,placement.top-placement.y]});
   // A leader keeps displaced labels tied to the precise reported position.
   const edge=view.containerPointToLatLng([Math.max(placement.left,Math.min(placement.left+placement.width,placement.x)),Math.max(placement.top,Math.min(placement.top+placement.height,placement.y))]);
   const endpoints:[L.LatLngExpression,L.LatLngExpression]=[[truck.point.latitude,truck.point.longitude],edge];
   const leader=existing?existing.leader.setLatLngs(endpoints):L.polyline(endpoints,{color:truck.selected?'#245fa4':'#334650',weight:1.5,opacity:.8,interactive:false}).addTo(truckOverlay);
   const dot=existing?.dot||L.circleMarker([truck.point.latitude,truck.point.longitude],{radius:3,color:truck.selected?'#245fa4':'#334650',weight:1,fillOpacity:1,interactive:false}).addTo(truckOverlay);
   renderedTrucks.set(truck.label,{marker,leader,dot});
   }
  };
  view.on('zoomend moveend resize',placeTrucks);
  fit.current=(allTrucks=false)=>{view.closePopup();const points=model.stops.map(s=>[s.point.latitude,s.point.longitude] as [number,number]);for(const path of model.paths)points.push(...path.points.map(p=>[p.latitude,p.longitude] as [number,number]));for(const truck of trucks)if(allTrucks||truck.selected)points.push([truck.point.latitude,truck.point.longitude]);if(points.length)view.fitBounds(L.latLngBounds(points),{padding:[60,60],maxZoom:15,animate:false});};
  // GPS refreshes update pins without taking away a dispatcher's chosen viewport.
  const key=JSON.stringify([selectedTruck,Boolean(activeTruck),model.stops.map(s=>[s.job.recordId,s.point]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
  if(fitted.current!==key){manualView.current=false;routed.current='';view.invalidateSize({pan:false});fit.current();fitted.current=key;}
  const routeKey=JSON.stringify(model.paths.map(path=>[path.leg.fromAppointmentId,path.leg.toAppointmentId]));
  if(model.paths.length&&routed.current!==routeKey&&!manualView.current){fit.current();routed.current=routeKey;}
  if(selected&&focused.current!==selected){const target=model.stops.find(s=>s.job.recordId===selected);if(target)view.panTo([target.point.latitude,target.point.longitude],{animate:false});}
  focused.current=selected;
  placeTrucks();
  return()=>{view.off('zoomend moveend resize',placeTrucks);};
  // The signature covers rendered map content; callbacks use the current ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[markerSignature]);
 return <section className="stop-order-map-panel" aria-label="Projected stop route">
  <header><strong>Projected route</strong><div className="stop-order-map-actions"><button type="button" onClick={()=>{manualView.current=false;fit.current();}}>Fit route</button>{trucks.length>0&&<button type="button" onClick={()=>{manualView.current=true;fit.current(true);}}>All trucks</button>}</div></header>
  <div ref={host} className="stop-order-map" role="region" aria-label="Truck positions, numbered appointment locations and projected road routes" />
  <div className="stop-order-map-status" role="status"><span className="stop-order-truck-status">{!fleet.isToday?'Truck positions are shown only for today.':activeTruck?`${activeTruck.label} · ${activeTruck.gps.label} · GPS ${activeTruck.reportedAt}`:`${truckDisplayLabel(selectedTruck)} · GPS position unavailable.`}</span>{stale?'Refresh stops to update the route.':loading?'Updating projected road routes…':`${model.paths.length} of ${Math.max(0,jobs.length-1)} road legs shown.`}{model.missingPins>0?` ${model.missingPins} stops need verified locations.`:''}{!loading&&!stale&&model.missingRoutes>0?' Unavailable routes are not drawn.':''}<span>Numbers follow your draft order. Road estimates exclude live traffic.</span></div>
 </section>;
}
