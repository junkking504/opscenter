'use client';
import {useMemo,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import type {CrewScheduledJob} from '@/lib/crew-dispatch';
import {sameTruck,truckDisplayText} from '@/lib/junkware-trucks';
import {waypointStops,hasWaypointLocation} from '@/lib/waypoint-route';
import styles from './route.module.css';
const RouteMap=dynamic(()=>import('./route-map'),{ssr:false,loading:()=> <div className={styles.mapEmpty} role="status">Loading route map…</div>});
export function RouteIcon({name}:{name:string}) {return <img src={`/crew-jobs/icons/${name}.svg`} width="20" height="20" alt=""/>;}
export default function RouteOverview({jobs,truck,date,allTrucks,onSelect,onMessages,pendingId}:{jobs:CrewScheduledJob[];truck:string;date:string;allTrucks:boolean;onSelect:(id:string)=>void;onMessages?:()=>void;pendingId?:string}){
 const mapSection=useRef<HTMLDivElement>(null);
 const [chosen,setChosen]=useState(truck),[expanded,setExpanded]=useState(false);
 const trucks=[...new Set(jobs.flatMap(job=>job.truck?[truckDisplayText(job.truck)]:[]))];
 const selected=allTrucks && trucks.some(value=>sameTruck(value,chosen))?chosen:truck;
 const stops=useMemo(()=>waypointStops(jobs,selected),[jobs,selected]);
 const completed=jobs.filter(job=>sameTruck(job.truck ?? selected,selected) && /completed/i.test(job.status));
 const shared=jobs.filter(job=>job.sharedAmazon && !sameTruck(job.truck || '',selected));
 const missing=stops.filter(stop=>!hasWaypointLocation(stop));
 const approximate=stops.filter(stop=>hasWaypointLocation(stop) && stop.job.mapLocation?.approximate);
 const dateLabel=/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}):'Today';
 return <section className={styles.overview} aria-label="Today’s route">
  <div className={styles.heading}><div><h1>Today’s route</h1><p>{truckDisplayText(selected)} · {dateLabel}</p></div>{onMessages&&<button className={styles.messages} onClick={onMessages}><RouteIcon name="message"/><span>Messages</span></button>}</div>
  {allTrucks && <label className={styles.truckSelect}>View truck<select value={truckDisplayText(selected)} onChange={e=>setChosen(e.target.value)}>{[...new Set([truckDisplayText(truck),...trucks])].map(value=><option key={value}>{value}</option>)}</select></label>}
  {stops.length>0 && <><div ref={mapSection}><RouteMap stops={stops} onSelect={onSelect} expanded={expanded}/></div>{approximate.length>0&&<p className={styles.mapNote}>Dashed pins are approximate: {approximate.map(stop=>stop.number).join(', ')}. Confirm the service address.</p>}{missing.length>0&&<p className={styles.mapNote}>Not on map: stop{missing.length===1?'':'s'} {missing.map(stop=>stop.number).join(', ')}. Location unavailable.</p>}</>}
  <div className={styles.sectionHeading}><h2>Route Order</h2><p>Follow this stop order.</p></div>
  {stops.length===0?<p>No remaining appointments for this truck.</p>:<ol className={styles.stops}>{stops.map((stop,index)=><li key={stop.job.appointmentId}>
   <button className={`${styles.stop} ${index===0?styles.next:''}`} onClick={()=>onSelect(stop.job.appointmentId)} aria-label={`Stop ${stop.number}: ${stop.job.customerName}, view appointment`}>
    <span className={styles.number}>{stop.number}</span><span className={styles.stopBody}><strong>{stop.job.customerName}</strong><span className={styles.fact}><RouteIcon name="clock"/>{stop.job.appointmentTime}</span><span className={styles.fact}><RouteIcon name="pin"/>{stop.job.address || 'Address unavailable'}</span>{stop.job.mapLocation?.approximate&&<small>Approximate map location</small>}{stop.job.readOnly&&<small>View only · Assigned to another truck</small>}{stop.job.assignmentId===pendingId&&<small>Checkout verification pending</small>}</span><RouteIcon name="chevron"/>
   </button>
  </li>)}</ol>}
  {stops.length>0&&<div className={styles.routeActions}><button className={styles.primary} onClick={()=>onSelect(stops[0].job.appointmentId)}>View next appointment<RouteIcon name="chevron"/></button>{stops.some(hasWaypointLocation)&&<button className={styles.secondary} aria-expanded={expanded} onClick={()=>{setExpanded(value=>!value);requestAnimationFrame(()=>mapSection.current?.scrollIntoView({block:'start'}));}}><RouteIcon name="map"/>{expanded?'Compact map':'Full map'}</button>}</div>}
  {completed.length>0&&<details className={styles.extra}><summary>Completed appointments ({completed.length})</summary>{completed.map(job=><button className={styles.otherJob} key={job.appointmentId} onClick={()=>onSelect(job.appointmentId)}>{job.customerName}<RouteIcon name="chevron"/></button>)}</details>}
  {shared.length>0&&<details className={styles.extra}><summary>Shared Amazon appointments ({shared.length})</summary><p>Available to all crews; separate from this truck’s Route Order.</p>{shared.map(job=><button className={styles.otherJob} key={job.appointmentId} onClick={()=>onSelect(job.appointmentId)}><span>{job.customerName}<small>{truckDisplayText(job.truck || '')} · {job.status}</small></span><RouteIcon name="chevron"/></button>)}</details>}
 </section>;
}
