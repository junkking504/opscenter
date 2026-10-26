'use client';
import {useState} from 'react';
import dynamic from 'next/dynamic';
import {Button} from '@astryxdesign/core/Button';
import {BrandTheme} from '@/components/astryx/BrandTheme';
import {hasMapLocation,type WaypointMapAppointment} from '@/lib/waypoint-map';
import styles from './route.module.css';
const Map=dynamic(()=>import('./route-map'),{ssr:false,loading:()=> <div className={styles.mapEmpty} role="status">Loading appointment map…</div>});

export default function AppointmentMap({appointments,onSelect,disabled=false}:{appointments:WaypointMapAppointment[];onSelect:(id:string)=>void;disabled?:boolean}) {
 const [expanded,setExpanded]=useState(false);
 const mapped=appointments.filter(hasMapLocation),missing=appointments.filter(row=>!hasMapLocation(row));
 return <BrandTheme waypoint><section className={styles.appointmentMap} aria-label="All appointments map">
  <div className={styles.sectionHeading}><h2>All appointments</h2>{mapped.length>0&&<Button label={expanded?'Compact map':'Full map'} variant="secondary" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}/>}</div>
  <p className={styles.mapNote}>{mapped.length} mapped · {missing.length} without a map location</p>
  {mapped.length>0?<Map appointments={appointments} onSelect={id=>{if(!disabled)onSelect(id);}} expanded={expanded}/>:<p className={styles.mapNote}>{appointments.length?'Map locations are unavailable. All appointments are listed below.':'No appointments in this schedule.'}</p>}
  {mapped.length>0&&<p className={styles.mapNote}>T = truck · ✓ Completed · × Cancelled · U = Unassigned. A count groups appointments at one location. Dashed pins are approximate; confirm the service address.</p>}
  {missing.length>0&&<details className={styles.mapDirectory}><summary>Appointments without a map location ({missing.length})</summary>{missing.map(row=><button className={styles.otherJob} disabled={disabled} key={row.id} onClick={()=>onSelect(row.id)}><span>{row.customerName}<small>{row.truck} · {row.status} · {row.address || 'Address unavailable'}</small></span></button>)}</details>}
  {mapped.length>0&&<details className={styles.mapDirectory}><summary>Browse mapped appointments ({mapped.length})</summary>{mapped.map(row=><button className={styles.otherJob} disabled={disabled} key={row.id} onClick={()=>onSelect(row.id)}><span>{row.label} · {row.customerName}<small>{row.truck} · {row.status}{row.location?.approximate?' · Approximate location':''}</small></span></button>)}</details>}
 </section></BrandTheme>;
}
