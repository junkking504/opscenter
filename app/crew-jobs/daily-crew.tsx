'use client';
import {useRef,useState} from 'react';
import type {CrewPhoneDay} from '@/lib/crew-phone';
import styles from './phone-access.module.css';
export default function DailyCrew({date,roster,trucks,day,onSaved,onCancel,onBusy}:{date:string;roster:string[];trucks:string[];day:CrewPhoneDay|null;onSaved:()=>void;onCancel:()=>void;onBusy:(busy:boolean)=>void}) {
 const [truck,setTruck]=useState(day?.truck || '');
 const [responsible,setResponsible]=useState(day?.responsible || ''),[driver,setDriver]=useState(day?.driver || ''),[navigator,setNavigator]=useState(day?.navigators[0] || '');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef<{fingerprint:string;requestId:string}|null>(null),inFlight=useRef(false);
 async function verify(){const response=await fetch('/api/crew-jobs/day',{cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.error || 'Today’s crew could not be verified.');if(body.day && body.date===date && (!request.current || body.day.requestId===request.current.requestId)){onSaved();return true;}return false;}
 async function save(event:React.FormEvent){event.preventDefault();if(inFlight.current)return;inFlight.current=true;setBusy(true);onBusy(true);setError('');
  try{
   const input={date,expectedVersion:day?.version || 0,truck,responsible,driver,navigators:navigator?[navigator]:[]};const fingerprint=JSON.stringify(input);
   if(request.current?.fingerprint!==fingerprint)request.current={fingerprint,requestId:crypto.randomUUID()};
   const response=await fetch('/api/crew-jobs/day',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,requestId:request.current.requestId})});
   const body=await response.json();if(!response.ok)throw new Error(body.error || 'Crew setup was not confirmed. Check saved crew before trying again.');
   if(!await verify())throw new Error('Check saved crew before trying again.');
  }catch(e){setError(e instanceof Error?e.message:'Crew setup was not confirmed. Check saved crew before trying again.');}
  finally{inFlight.current=false;setBusy(false);onBusy(false);}
 }
 return <section className={styles.card}><h1>{day?'Change today’s truck & crew':'Set up your truck phone'}</h1><p>{date} · Central time</p><p>Choose your assigned truck and crew for today, then continue to the truck inspection.</p>
  <form className={styles.form} onSubmit={save}>
   <label>Assigned truck<select required disabled={busy} value={truck} onChange={e=>setTruck(e.target.value)}><option value="">Choose your truck</option>{trucks.map(name=><option key={name}>{name}</option>)}</select></label>
   <label>Person responsible for this phone<select required disabled={busy} value={responsible} onChange={e=>setResponsible(e.target.value)}><option value="">Choose person</option>{roster.map(name=><option key={name}>{name}</option>)}</select></label>
   <label>Driver<select required disabled={busy} value={driver} onChange={e=>setDriver(e.target.value)}><option value="">Choose driver</option>{roster.map(name=><option key={name}>{name}</option>)}</select></label>
   <label>Navigator<select disabled={busy} value={navigator} onChange={e=>setNavigator(e.target.value)}><option value="">No navigator — driver only</option>{roster.filter(name=>name!==driver).map(name=><option key={name}>{name}</option>)}</select></label>
   <button className={styles.primary} disabled={busy || !truck || !responsible || !driver || driver===navigator}>{busy?'Saving setup…':'Continue to inspection'}</button>
  </form>
  {!roster.length && <p role="alert">The crew list is unavailable. Contact your manager.</p>}
  {error && <p className={styles.error} role="alert">{error}</p>}
  <button className={styles.secondary} disabled={busy} onClick={()=>void verify().then(found=>{if(!found)setError('No crew assignment has been saved for today.');}).catch(e=>setError(e.message))}>Check saved crew</button>
  {day && <button className={styles.secondary} disabled={busy} onClick={onCancel}>Keep current setup</button>}
 </section>;
}
