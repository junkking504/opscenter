'use client';
import {Button} from '@astryxdesign/core/Button';
import {BrandTheme} from '@/components/astryx/BrandTheme';
import {useMemo,useState} from 'react';
import type {CrewScheduledJob} from '@/lib/crew-dispatch';
import {sameTruck,truckDisplayText} from '@/lib/junkware-trucks';
import {waypointStops} from '@/lib/waypoint-route';
import {crewMapAppointments} from '@/lib/waypoint-map';
import AppointmentMap from './appointment-map';
import AppointmentContacts from './appointment-contacts';
import styles from './route.module.css';
export function RouteIcon({name}:{name:string}) {return <img src={`/crew-jobs/icons/${name}.svg?v=2`} width="20" height="20" alt=""/>;}
export default function RouteOverview({jobs,truck,date,allTrucks,onSelect,pendingId,view='route',chosenTruck,onTruckChange}:{view?:'route'|'completed';chosenTruck?:string;onTruckChange?:(truck:string)=>void;jobs:CrewScheduledJob[];truck:string;date:string;allTrucks:boolean;onSelect:(id:string)=>void;pendingId?:string}){
 const [localChosen,setLocalChosen]=useState(truck);
 const chosen=chosenTruck ?? localChosen;
 const setChosen=onTruckChange ?? setLocalChosen;
 const trucks=[...new Set(jobs.flatMap(job=>job.truck?[truckDisplayText(job.truck)]:[]))];
 const selected=allTrucks && trucks.some(value=>sameTruck(value,chosen))?chosen:truck;
 const stops=useMemo(()=>waypointStops(jobs,selected),[jobs,selected]);
 const mapAppointments=useMemo(()=>crewMapAppointments(jobs),[jobs]);
 const completed=jobs.filter(job=>sameTruck(job.truck ?? selected,selected) && /completed/i.test(job.status));
 const shared=jobs.filter(job=>job.sharedAmazon && !sameTruck(job.truck || '',selected));
 const dateLabel=/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(`${date}T12:00:00`).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}):'Today';
 return <BrandTheme waypoint><section className={styles.overview} aria-label={view==='completed'?'Completed Appointments':'Today’s Route'}>
  <div className={styles.heading}><div><p className={styles.eyebrow}>{dateLabel}</p><h1>{view==='completed'?'Completed Appointments':'Today’s Route'}</h1><p>{truckDisplayText(selected)}</p></div></div>
  {allTrucks && <label className={styles.truckSelect}>View truck<select value={truckDisplayText(selected)} onChange={e=>setChosen(e.target.value)}>{[...new Set([truckDisplayText(truck),...trucks])].map(value=><option key={value}>{value}</option>)}</select></label>}
  {view==='completed'?<>{completed.length?<div>{completed.map(job=><article key={job.appointmentId}><button className={styles.otherJob} onClick={()=>onSelect(job.appointmentId)}><span>{job.customerName}<small>{job.appointmentTime} · Completed</small></span><RouteIcon name="chevron"/></button><AppointmentContacts address={job.address} phone={job.phone}/></article>)}</div>:<p>No completed appointments for this truck today.</p>}</>:<>
  <AppointmentMap appointments={mapAppointments} onSelect={onSelect}/>
  <div className={styles.sectionHeading}><h2>Route Order</h2></div>
  {stops.length===0?<p>No remaining appointments for this truck.</p>:<ol className={styles.stops}>{stops.map((stop,index)=><li key={stop.job.appointmentId}>
   <button className={`${styles.stop} ${index===0?styles.next:''}`} onClick={()=>onSelect(stop.job.appointmentId)} aria-label={`Stop ${stop.number}: ${stop.job.customerName}, view appointment`}>
    <span className={styles.number}>{stop.number}</span><span className={styles.stopBody}><strong>{stop.job.customerName}</strong><span className={styles.fact}><RouteIcon name="clock"/>{stop.job.appointmentTime}</span>{stop.job.mapLocation?.approximate&&<small>Approximate map location</small>}{stop.job.readOnly&&<small>View only · Assigned to another truck</small>}{stop.job.assignmentId===pendingId&&<small>Checkout verification pending</small>}</span><RouteIcon name="chevron"/>
   </button>
   <AppointmentContacts address={stop.job.address} phone={stop.job.phone} customerName={stop.job.customerName} actions={!stop.job.readOnly}/>
  </li>)}</ol>}
  {stops.length>0&&<div className={styles.routeActions}><Button label="View Next Appointment" variant="primary" size="md" width="100%" onClick={()=>onSelect(stops[0].job.appointmentId)} /></div>}
  {shared.length>0&&<details className={styles.extra}><summary>Shared Amazon Appointments ({shared.length})</summary><p>Available to all crews; separate from this truck’s Route Order.</p>{shared.map(job=><article key={job.appointmentId}><button className={styles.otherJob} onClick={()=>onSelect(job.appointmentId)}><span>{job.customerName}<small>{truckDisplayText(job.truck || '')} · {job.status}</small></span><RouteIcon name="chevron"/></button><AppointmentContacts address={job.address} phone={job.phone}/></article>)}</details>}
 </>}
 </section></BrandTheme>;
}
