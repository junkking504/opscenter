'use client';
import { useEffect, useRef, useState } from 'react';
import type { CrewDispatch } from '@/lib/crew-dispatch';
import styles from '../../crew-jobs/phone-access.module.css';
type Snapshot={dispatch:CrewDispatch;trucks:string[];date:string;sourceFresh:boolean;observedAt:string|null;jobs:Array<{appointmentId:string;version:string;customerName:string;appointmentTime:string;status:string}>};
export default function CrewDispatchPage(){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [truck,setTruck]=useState('Truck 1');
  const [date,setDate]=useState('');
  const [selected,setSelected]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const inFlight=useRef(false),requestNumber=useRef(0);
  async function load(selectedTruck=truck,selectedDate=date){
    const sequence=++requestNumber.current;
    setLoading(true);setError('');setSnapshot(null);setSelected('');
    try{
      const params=new URLSearchParams({truck:selectedTruck});if(selectedDate)params.set('date',selectedDate);
      const response=await fetch(`/api/crew-dispatch?${params}`,{cache:'no-store'}),body=await response.json();
      if(sequence!==requestNumber.current)return;
      if(!response.ok)throw new Error(body.error || 'Dispatch could not be loaded.');
      setSnapshot(body);setDate(body.date);setTruck(body.dispatch.truck);
    }catch(error){if(sequence===requestNumber.current)setError(error instanceof Error?error.message:'Dispatch could not be loaded.');}
    finally{if(sequence===requestNumber.current)setLoading(false);}
  }
  useEffect(()=>{void load();return()=>{requestNumber.current++;};},[]);
  async function send(action:'release'|'clear-queued'){
    if(inFlight.current || !snapshot)return;
    const job=snapshot.jobs.find(row=>row.appointmentId===selected);
    inFlight.current=true;setBusy(true);setError('');
    try{
      const response=await fetch('/api/crew-dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        action,requestId:crypto.randomUUID(),truck:snapshot.dispatch.truck,expectedVersion:snapshot.dispatch.version,
        date:snapshot.date,...(action==='release'?{appointmentId:job?.appointmentId,expectedJobVersion:job?.version}:{}),
      })});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error || 'Assignment result could not be verified. Refresh dispatch before another change.');
      await load();
    }catch(error){setError(error instanceof Error?error.message:'Assignment result could not be verified. Refresh dispatch before another change.');}
    finally{inFlight.current=false;setBusy(false);}
  }
  const label=(id:string)=>snapshot?.jobs.find(job=>job.appointmentId===id)?.customerName || `Appointment ${id}`;
  const jobs=snapshot?.jobs.filter(job=>/^confirmed$/i.test(job.status) && job.appointmentId!==snapshot.dispatch.current?.appointmentId && job.appointmentId!==snapshot.dispatch.queued?.appointmentId) || [];
  return <main className={styles.page}><div className={styles.content}><h1>Crew dispatch</h1><p>Each truck phone sees one job at a time.</p>
    <div className={styles.form}><label>Truck<select value={truck} disabled={busy || loading} onChange={event=>{setTruck(event.target.value);void load(event.target.value,date);}}>{(snapshot?.trucks || [truck]).map(value=><option key={value}>{value}</option>)}</select></label><label>Appointment date<input type="date" value={date} disabled={busy || loading} onChange={event=>{setDate(event.target.value);if(event.target.value)void load(truck,event.target.value);}}/></label></div>
    <button className={styles.secondary} disabled={busy || loading} onClick={()=>void load()}>{loading?'Loading…':'Refresh dispatch'}</button>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {snapshot && <><section className={styles.card}><h2>Current assignment</h2>{snapshot.dispatch.current?<><p>{label(snapshot.dispatch.current.appointmentId)}</p><p>{snapshot.dispatch.current.date}</p><p className={styles.muted}>The crew must finish this appointment with photos before seeing another job.</p></>:<p>No current assignment.</p>}</section>
      <section className={styles.card}><h2>Queued assignment</h2>{snapshot.dispatch.queued?<><p>{label(snapshot.dispatch.queued.appointmentId)}</p><p>Hidden from the crew until verified closeout.</p><button className={styles.secondary} disabled={busy} onClick={()=>void send('clear-queued')}>Remove queued assignment</button></>:<p>No job queued.</p>}</section>
      {!snapshot.sourceFresh && <p className={styles.error}>Schedule data is unavailable or more than ten minutes old. Refresh the schedule before assigning a job.</p>}
      <form className={styles.form} onSubmit={event=>{event.preventDefault();void send('release');}}><label>{snapshot.dispatch.current?'Next assignment':'Assign current job'}<select value={selected} onChange={event=>setSelected(event.target.value)} disabled={busy || !snapshot.sourceFresh || Boolean(snapshot.dispatch.queued)} required><option value="">Choose a confirmed job</option>{jobs.map(job=><option key={job.appointmentId} value={job.appointmentId}>{job.appointmentTime} · {job.customerName}</option>)}</select></label><button className={styles.primary} disabled={busy || !selected || !snapshot.sourceFresh || Boolean(snapshot.dispatch.queued)}>{busy?'Checking JunkWare…':snapshot.dispatch.current?'Queue next job':'Assign job'}</button></form>
    </>}
    <p><a href="/crew-phones">Manage company phones</a></p>
  </div></main>;
}
