'use client';
import {useEffect,useRef,useState} from 'react';
import {loadAppleMapKit} from '../../desktop-ui/lib/apple-mapkit';
import {hasMapLocation,waypointMapStatus,type WaypointMapAppointment} from '@/lib/waypoint-map';
import styles from './route.module.css';

/** Apple Maps display for Waypoint's appointment map. Display only: no search, directions or geocoding. */
export default function RouteAppleMap({token,appointments,onSelect,expanded,onFailure}:{token:string;appointments:WaypointMapAppointment[];onSelect:(id:string)=>void;expanded:boolean;onFailure:()=>void}) {
 const node=useRef<HTMLDivElement>(null);
 const select=useRef(onSelect);useEffect(()=>{select.current=onSelect;},[onSelect]);
 const failure=useRef(onFailure);useEffect(()=>{failure.current=onFailure;},[onFailure]);
 const [choices,setChoices]=useState<WaypointMapAppointment[]>([]);
 useEffect(()=>{
  let cancelled=false,cleanup=()=>{};setChoices([]);
  const located=appointments.filter(hasMapLocation);
  if(!located.length || !node.current)return;
  void loadAppleMapKit(token).then(kit=>{
   if(cancelled || !node.current)return;
   const host=node.current;
   const instance=new kit.Map(host,{showsZoomControl:true,showsMapTypeControl:false,showsUserLocationControl:false,isRotationEnabled:false,isZoomEnabled:true,isScrollEnabled:true});
   const fail=()=>{if(!cancelled)failure.current();};
   kit.addEventListener('error',fail);
   const groups=new Map<string,WaypointMapAppointment[]>();
   for(const stop of located){const p=stop.location!;const key=`${p.latitude},${p.longitude}`;groups.set(key,[...(groups.get(key)||[]),stop]);}
   const items:ReturnType<typeof makeItem>[]=[];
   function makeItem(group:WaypointMapAppointment[]) {
    const p=group[0].location!,label=group.length>1?String(group.length):group[0].label;
    const width=Math.max(36,label.length*9+18);
    const holder=document.createElement('button');holder.type='button';holder.className=styles.markerHost;
    holder.style.width=`${width}px`;holder.style.height='36px';
    holder.setAttribute('aria-label',group.map(row=>`${row.label} · ${row.customerName} · ${row.truck} · ${row.status}`).join('; '));
    const badge=document.createElement('span');badge.className=styles.marker;badge.textContent=label;
    if(group.every(row=>waypointMapStatus(row.status)==='completed'))badge.classList.add(styles.completedMarker);
    if(group.every(row=>waypointMapStatus(row.status)==='cancelled'))badge.classList.add(styles.cancelledMarker);
    if(group.some(stop=>stop.location?.approximate))badge.classList.add(styles.approximate);
    holder.append(badge);
    holder.addEventListener('click',()=>{if(group.length===1){setChoices([]);select.current(group[0].id);}else setChoices(group);});
    const annotation=new kit.Annotation(new kit.Coordinate(p.latitude,p.longitude),()=>holder,{animates:false,enabled:true,calloutEnabled:false,displayPriority:1000});
    instance.addAnnotation(annotation);
    return annotation;
   }
   try{for(const group of groups.values())items.push(makeItem([...group]));}catch{fail();}
   const lat=located.map(stop=>stop.location!.latitude),lon=located.map(stop=>stop.location!.longitude);
   const south=Math.min(...lat),north=Math.max(...lat),west=Math.min(...lon),east=Math.max(...lon);
   const fit=()=>{
    const pad=1.4;
    instance.region=new kit.CoordinateRegion(new kit.Coordinate((south+north)/2,(west+east)/2),new kit.CoordinateSpan(Math.max((north-south)*pad,0.01),Math.max((east-west)*pad,0.01)));
   };
   fit();
   const observer=new ResizeObserver(fit);observer.observe(host);
   cleanup=()=>{observer.disconnect();kit.removeEventListener('error',fail);try{items.forEach(item=>instance.removeAnnotation(item));instance.destroy();}catch{/* Already torn down. */}};
  }).catch(()=>{if(!cancelled)failure.current();});
  return ()=>{cancelled=true;cleanup();};
 },[appointments,token]);
 return <div className={`${styles.mapWrap} ${expanded?styles.expanded:''}`}>
  <div ref={node} className={styles.map} aria-label="Map of all appointments"/>
  {choices.length>0&&<div role="group" aria-label="Appointments at this location">{choices.map(stop=><button key={stop.id} type="button" className={styles.mapChoice} onClick={()=>{setChoices([]);select.current(stop.id);}}>{stop.label} · {stop.customerName} · {stop.truck} · {stop.status}</button>)}</div>}
 </div>;
}
