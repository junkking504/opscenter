'use client';
import {useEffect,useRef,useState} from 'react';
import type {Map as LeafletMap} from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {hasWaypointLocation,type WaypointStop} from '@/lib/waypoint-route';
import styles from './route.module.css';

export default function RouteMap({stops,onSelect,expanded}:{stops:WaypointStop[];onSelect:(id:string)=>void;expanded:boolean}) {
 const node=useRef<HTMLDivElement>(null),map=useRef<LeafletMap|null>(null);
 const select=useRef(onSelect);useEffect(()=>{select.current=onSelect;},[onSelect]);
 const [error,setError]=useState('');
 useEffect(()=>{
  let cancelled=false;let cleanup=()=>{};
  void import('leaflet').then(L=>{
   if(cancelled || !node.current)return;
   const located=stops.filter(hasWaypointLocation);
   if(!located.length)return;
   const instance=L.map(node.current,{scrollWheelZoom:false,attributionControl:true,zoomAnimation:false});map.current=instance;
   L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',maxZoom:19,
   }).on('tileerror',()=>{if(!cancelled)setError('Map tiles are unavailable. The numbered appointment list is still available below.');}).addTo(instance);
   // Co-located appointments share one marker listing every stop number. No
   // fake offset coordinates, hidden pins, or customer text interpolated as HTML.
   const groups=new Map<string,WaypointStop[]>();
   for(const stop of located){const p=stop.job.mapLocation!;const key=`${p.latitude},${p.longitude}`;groups.set(key,[...(groups.get(key)||[]),stop]);}
   for(const group of groups.values()){
    const p=group[0].job.mapLocation!,label=group.map(stop=>stop.number).join(', ');
    const badge=document.createElement('span');badge.className=styles.marker;badge.textContent=label;
    if(group.some(stop=>stop.job.mapLocation?.approximate))badge.classList.add(styles.approximate);
    const marker=L.marker([p.latitude,p.longitude],{icon:L.divIcon({html:badge,className:styles.markerHost,iconSize:[Math.max(36,label.length*9+18),36],iconAnchor:[18,18]}),title:`Stop ${label}${group.some(stop=>stop.job.mapLocation?.approximate)?' · Approximate location':''}`,keyboard:true}).addTo(instance);
    if(group.length===1)marker.on('click',()=>select.current(group[0].job.appointmentId));
    else {
     const choices=document.createElement('div');
     for(const stop of group){const button=document.createElement('button');button.type='button';button.className=styles.mapChoice;button.textContent=`${stop.number}. ${stop.job.customerName}`;button.onclick=()=>select.current(stop.job.appointmentId);choices.append(button);}
     marker.bindPopup(choices);
    }
   }
   const bounds=L.latLngBounds(located.map(stop=>[stop.job.mapLocation!.latitude,stop.job.mapLocation!.longitude] as [number,number]));
   instance.fitBounds(bounds,{padding:[32,32],maxZoom:15,animate:false});
   const observer=new ResizeObserver(()=>{instance.invalidateSize();instance.fitBounds(bounds,{padding:[32,32],maxZoom:15,animate:false});});observer.observe(node.current);
   cleanup=()=>{observer.disconnect();instance.remove();map.current=null;};
  }).catch(()=>{if(!cancelled)setError('Map could not load. Use the numbered appointment list below.');});
  return ()=>{cancelled=true;cleanup();};
 },[stops]);
 const located=stops.filter(hasWaypointLocation);
 if(!located.length)return <div className={styles.mapEmpty}>Map locations are unavailable for these stops. All appointments remain in Route Order below.</div>;
 return <div className={`${styles.mapWrap} ${expanded?styles.expanded:''}`}><div ref={node} className={styles.map} aria-label="Map of numbered appointments"/>{error && <p role="status" className={styles.mapWarning}>{error}</p>}</div>;
}
