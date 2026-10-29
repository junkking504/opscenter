'use client';
import {useEffect,useRef,useState} from 'react';
import {loadAppleMapKit} from '../../desktop-ui/lib/apple-mapkit';
import {startAppleMap} from './apple-map-session';
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
   cleanup=startAppleMap(kit,node.current,located,{
    onFailure:()=>{if(!cancelled)failure.current();},
    makeElement:group=>{
     const label=group.length>1?String(group.length):group[0].label;
     const holder=document.createElement('button');holder.type='button';holder.className=styles.markerHost;
     holder.style.width=`${Math.max(36,label.length*9+18)}px`;holder.style.height='36px';
     holder.setAttribute('aria-label',group.map(row=>`${row.label} · ${row.customerName} · ${row.truck} · ${row.status}`).join('; '));
     const badge=document.createElement('span');badge.className=styles.marker;badge.textContent=label;
     if(group.every(row=>waypointMapStatus(row.status)==='completed'))badge.classList.add(styles.completedMarker);
     if(group.every(row=>waypointMapStatus(row.status)==='cancelled'))badge.classList.add(styles.cancelledMarker);
     if(group.some(stop=>stop.location?.approximate))badge.classList.add(styles.approximate);
     holder.append(badge);
     holder.addEventListener('click',()=>{if(group.length===1){setChoices([]);select.current(group[0].id);}else setChoices(group);});
     return holder;
    },
   });
   // The effect may have been torn down while the SDK was loading or setup was running.
   if(cancelled)cleanup();
  }).catch(()=>{if(!cancelled)failure.current();});
  return ()=>{cancelled=true;cleanup();};
 },[appointments,token]);
 return <div className={`${styles.mapWrap} ${expanded?styles.expanded:''}`}>
  <div ref={node} className={styles.map} aria-label="Map of all appointments"/>
  {choices.length>0&&<div role="group" aria-label="Appointments at this location">{choices.map(stop=><button key={stop.id} type="button" className={styles.mapChoice} onClick={()=>{setChoices([]);select.current(stop.id);}}>{stop.label} · {stop.customerName} · {stop.truck} · {stop.status}</button>)}</div>}
 </div>;
}
