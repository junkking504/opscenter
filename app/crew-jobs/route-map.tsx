'use client';
import {useEffect,useRef,useState} from 'react';
import type {Map as LeafletMap} from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {clusterByScreenDistance,hasMapLocation,waypointMapStatus,type WaypointMapAppointment} from '@/lib/waypoint-map';
import styles from './route.module.css';

const MIN_PIN_GAP=40;

export default function RouteMap({appointments,onSelect,expanded}:{appointments:WaypointMapAppointment[];onSelect:(id:string)=>void;expanded:boolean}) {
 const node=useRef<HTMLDivElement>(null),map=useRef<LeafletMap|null>(null);
 const select=useRef(onSelect);useEffect(()=>{select.current=onSelect;},[onSelect]);
 const [error,setError]=useState('');
 useEffect(()=>{
  let cancelled=false;let cleanup=()=>{};setError('');
  void import('leaflet').then(L=>{
   if(cancelled || !node.current)return;
   const located=appointments.filter(hasMapLocation);
   if(!located.length)return;
   const instance=L.map(node.current,{scrollWheelZoom:false,attributionControl:true,zoomAnimation:false});map.current=instance;
   L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',maxZoom:19,
   }).on('tileerror',()=>{if(!cancelled)setError('Map tiles are unavailable. The appointment list is still available below.');}).addTo(instance);
   // Appointments that would overlap on screen share one count marker whose popup lists every
   // appointment. Regrouped on each zoom; no fake offset coordinates, hidden pins, or customer
   // text interpolated as HTML.
   const layer=L.layerGroup().addTo(instance);
   const draw=()=>{
    layer.clearLayers();
    const points=located.map(stop=>{const at=instance.latLngToContainerPoint([stop.location!.latitude,stop.location!.longitude]);return {x:at.x,y:at.y,item:stop};});
    for(const group of clusterByScreenDistance(points,MIN_PIN_GAP)){
     const latitude=group.reduce((sum,row)=>sum+row.location!.latitude,0)/group.length,longitude=group.reduce((sum,row)=>sum+row.location!.longitude,0)/group.length;
     const label=group.length>1?String(group.length):group[0].label;
     const markerWidth=Math.max(36,label.length*9+18);
     const badge=document.createElement('span');badge.className=styles.marker;badge.textContent=label;
     if(group.every(row=>waypointMapStatus(row.status)==='completed'))badge.classList.add(styles.completedMarker);
     if(group.every(row=>waypointMapStatus(row.status)==='cancelled'))badge.classList.add(styles.cancelledMarker);
     if(group.some(stop=>stop.location?.approximate))badge.classList.add(styles.approximate);
     const marker=L.marker([latitude,longitude],{icon:L.divIcon({html:badge,className:styles.markerHost,iconSize:[markerWidth,36],iconAnchor:[markerWidth/2,18]}),title:group.map(row=>`${row.label} · ${row.customerName} · ${row.truck} · ${row.status}${row.location?.approximate?' · Approximate location':''}`).join('; '),keyboard:true}).addTo(layer);
     if(group.length===1)marker.on('click',()=>select.current(group[0].id));
     else {
      const choices=document.createElement('div');
      for(const stop of group){const button=document.createElement('button');button.type='button';button.className=styles.mapChoice;button.textContent=`${stop.label} · ${stop.customerName} · ${stop.truck} · ${stop.status}`;button.onclick=()=>select.current(stop.id);choices.append(button);}
      marker.bindPopup(choices);
     }
    }
   };
   const bounds=L.latLngBounds(located.map(stop=>[stop.location!.latitude,stop.location!.longitude] as [number,number]));
   instance.fitBounds(bounds,{padding:[32,32],maxZoom:15,animate:false});draw();instance.on('zoomend',draw);
   const observer=new ResizeObserver(()=>{instance.invalidateSize();instance.fitBounds(bounds,{padding:[32,32],maxZoom:15,animate:false});draw();});observer.observe(node.current);
   cleanup=()=>{observer.disconnect();instance.off('zoomend',draw);instance.remove();map.current=null;};
  }).catch(()=>{if(!cancelled)setError('Map could not load. Use the appointment list below.');});
  return ()=>{cancelled=true;cleanup();};
 },[appointments]);
 const located=appointments.filter(hasMapLocation);
 if(!located.length)return <div className={styles.mapEmpty}>Map locations are unavailable. Use the appointment list below.</div>;
 return <div className={`${styles.mapWrap} ${expanded?styles.expanded:''}`}><div ref={node} className={styles.map} aria-label="Map of all appointments"/>{error && <p role="status" className={styles.mapWarning}>{error}</p>}</div>;
}
