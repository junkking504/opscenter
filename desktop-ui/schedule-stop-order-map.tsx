import {useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {appointmentServiceAddress} from '../lib/service-address-format';
import type {ScheduleAppointment,ScheduleRouteLeg} from './lib/schedule-contract';
import {stopOrderMap} from './lib/stop-order-map';

export default function ScheduleStopOrderMap({jobs,legs,selected,onSelect,loading,stale}:{jobs:ScheduleAppointment[];legs:ScheduleRouteLeg[];selected:string|null;onSelect:(id:string)=>void;loading:boolean;stale:boolean}) {
 const host=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null);
 const current=useRef({onSelect});current.current={onSelect};
 const fit=useRef<()=>void>(()=>{}),fitted=useRef(''),focused=useRef<string|null>(null);
 const manualView=useRef(false),routed=useRef('');
 const model=stopOrderMap(jobs,stale||loading?[]:legs);
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
  fit.current=()=>{const points=model.stops.map(s=>[s.point.latitude,s.point.longitude] as [number,number]);for(const path of model.paths)points.push(...path.points.map(p=>[p.latitude,p.longitude] as [number,number]));if(points.length)view.fitBounds(L.latLngBounds(points),{padding:[36,36],maxZoom:15,animate:false});};
  const key=JSON.stringify(model.stops.map(s=>[s.job.recordId,s.point]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
  if(fitted.current!==key){manualView.current=false;routed.current='';view.invalidateSize({pan:false});fit.current();fitted.current=key;}
  const routeKey=JSON.stringify(model.paths.map(path=>[path.leg.fromAppointmentId,path.leg.toAppointmentId]));
  if(model.paths.length&&routed.current!==routeKey&&!manualView.current){fit.current();routed.current=routeKey;}
  if(selected&&focused.current!==selected){const target=model.stops.find(s=>s.job.recordId===selected);if(target)view.panTo([target.point.latitude,target.point.longitude],{animate:false});}
  focused.current=selected;
 });
 return <section className="stop-order-map-panel" aria-label="Projected stop route">
  <header><strong>Projected route</strong><button type="button" onClick={()=>{manualView.current=false;fit.current();}}>Fit all stops</button></header>
  <div ref={host} className="stop-order-map" role="region" aria-label="Numbered appointment locations and projected road routes" />
  <div className="stop-order-map-status" role="status">{stale?'Refresh stops to update the route.':loading?'Updating projected road routes…':`${model.paths.length} of ${Math.max(0,jobs.length-1)} road legs shown.`}{model.missingPins>0?` ${model.missingPins} stops need verified locations.`:''}{!loading&&!stale&&model.missingRoutes>0?' Unavailable routes are not drawn.':''}<span>Numbers follow your draft order. Road estimates exclude live traffic.</span></div>
 </section>;
}
