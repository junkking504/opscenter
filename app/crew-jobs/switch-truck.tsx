'use client';
import { truckDisplayText } from '../../lib/junkware-trucks';
import {useEffect,useRef,useState} from 'react';
import type {CrewInspectionState,CrewPhoneDay} from '@/lib/crew-phone';
import styles from './phone-access.module.css';
export type SwitchSummary={requestId:string;from:string;to:string;status:'moving'|'attention'|'complete';message:string;total:number;moved:number};
type Preview={from:string;to:string;count:number;fingerprint:string;inspection:CrewInspectionState};
export default function SwitchTruck({day,trucks,pending,onDone,onCancel,onBusy}:{day:CrewPhoneDay;trucks:string[];pending:SwitchSummary|null;onDone:()=>void;onCancel:()=>void;onBusy:(value:boolean)=>void}){
 const [truck,setTruck]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[saved,setSaved]=useState(pending),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const flight=useRef(false),request=useRef<string|null>(null);
 async function api(body?:unknown){const response=await fetch(`/api/crew-jobs/switch-truck${body?'':truck?`?truck=${encodeURIComponent(truck)}`:''}`,{method:body?'POST':'GET',cache:'no-store',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(210_000)});const data=await response.json();if(!response.ok)throw new Error(data.error || 'The truck switch could not be verified. Check the saved switch.');return data;}
 async function run(action:'preview'|'confirm'|'continue'){
  if(flight.current)return;flight.current=true;setBusy(true);onBusy(true);setError('');
  try{
   let result;
   if(action==='preview'){result=await api();if(result.preview){setPreview(result.preview);return;}}
   else if(action==='confirm'){request.current ||= crypto.randomUUID();result=await api({action:'confirm',requestId:request.current,to:preview!.to,fingerprint:preview!.fingerprint});}
   else {result=saved?{switch:saved}:await api();}
   let current:SwitchSummary|undefined=result.switch;
   if(!current)throw new Error('No saved switch found. Review the replacement truck.');
   setSaved(current);
   // Each POST advances one already-confirmed step. Stop on uncertainty.
   do {if(current.status==='complete'){onDone();return;}const next=await api({action:'continue',requestId:current.requestId});current=next.switch;setSaved(current!);}while(current?.status==='moving');
   if(current?.status==='complete')onDone();
  }catch(e){setError(e instanceof Error?e.message:'The switch could not be verified. Check the saved switch.');}
  finally{flight.current=false;setBusy(false);onBusy(false);}
 }
 useEffect(()=>{if(pending?.status==='moving')void run('continue');},[]);
 return <section className={styles.card}><h1>Switch truck</h1>
  <p>{day.driver} · Driver{day.navigators.length?` · ${day.navigators.join(', ')} · Navigator`:''}</p>
  {saved?<><h2>{saved.from} → {saved.to}</h2><p role="status">{saved.message}</p><p>{saved.moved} of {saved.total} unfinished jobs moved.</p>{!busy && <button className={styles.primary} onClick={()=>void run('continue')}>Check saved switch</button>}<p>Your crew and saved job progress stay with this phone.</p></>:<>
   <p>Current truck: <strong>{truckDisplayText(day.truck)}</strong></p><label className={styles.form}>Replacement truck<select required disabled={busy} value={truck} onChange={e=>{setTruck(e.target.value);setPreview(null);request.current=null;}}><option value="">Choose a truck</option>{trucks.filter(t=>t!==day.truck).map(t=><option key={t} value={t}>{truckDisplayText(t)}</option>)}</select></label>
   {preview?<><h2>{truckDisplayText(preview.from)} → {truckDisplayText(preview.to)}</h2><p>{preview.count} unfinished {preview.count===1?'job moves':'jobs move'} with your crew. Completed jobs stay with {truckDisplayText(preview.from)}. Saved photos and closeout progress stay attached to their jobs.</p><p>{preview.inspection.status==='ready'?'This truck has already been inspected today. You can continue to jobs once the switch is verified.':preview.inspection.status==='blocked'?'Do not operate: this truck’s latest inspection blocks jobs. Contact your manager.':'Inspect this truck after switching, then continue to jobs.'}</p><button className={styles.primary} disabled={busy} onClick={()=>void run('confirm')}>Move our unfinished jobs to {preview.to}</button></>:<button className={styles.primary} disabled={busy || !truck} onClick={()=>void run('preview')}>Review switch</button>}
   <button className={styles.secondary} disabled={busy} onClick={onCancel}>Keep {truckDisplayText(day.truck)}</button>
  </>}
  {busy && <p role="status">Verifying the truck switch… Keep this page open.</p>}{error && <><p role="alert" className={styles.error}>{error}</p><button className={styles.secondary} disabled={busy} onClick={()=>void run('continue')}>Check saved switch</button></>}
 </section>;
}
