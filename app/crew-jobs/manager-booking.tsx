'use client';
import {useRef,useState} from 'react';
import {managerRequest} from './manager-api';
import type {PrebookingCheck} from '@/lib/prebooking-duplicates';
import styles from './phone-access.module.css';
import {useManagerLeaveGuard,type LeaveGuard} from './manager-navigation';
import {unresolvedManagerReceipt} from './manager-presentation';
export default function ManagerBooking({date,trucks,onClose,onSaved,onGuard}:{onGuard?:(guard:LeaveGuard|null)=>void;date:string;trucks:string[];onClose:()=>void;onSaved:()=>void}){
 const [form,setForm]=useState({date,truck:trucks[0] || '',franchise:'New Orleans',startTime:'09:00',durationHours:1,appointmentType:'Job',firstName:'',lastName:'',phone:'',email:'',serviceAddress:'',serviceZip:'',howHeard:'Returning',scope:'',notes:'',duplicateOverrideReason:''});
 const [check,setCheck]=useState<PrebookingCheck|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[separate,setSeparate]=useState(false);
 const [receipt,setReceipt]=useState<{requestId:string;status:string;error?:string;result?:{jkNumber:string}}|null>(null);
 const [dirty,setDirty]=useState(false);
 const leave=useManagerLeaveGuard({busy,pending:unresolvedManagerReceipt(receipt),dirty:dirty&&receipt?.status!=='verified',onBlocked:setError,onGuard});
 const requestId=useRef(''),inFlight=useRef(false);
 const update=(key:keyof typeof form,value:string|number)=>{setDirty(true);setForm({...form,[key]:value});setCheck(null);setSeparate(false);};
 const payload=()=>({...form,requestId:requestId.current,business:false,company:'',billingAddress:form.serviceAddress,billingZip:form.serviceZip,billingEmail:form.email,serviceContactName:'',serviceContactPhone:'',estimatedPickups:1});
 async function run(work:()=>Promise<void>){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'Check the saved result before another booking.');}finally{inFlight.current=false;setBusy(false);}}
 const field=(key:keyof typeof form,label:string,type='text')=><label key={key}>{label}<input type={type} step={type==='time'?3600:undefined} value={form[key]} onChange={e=>update(key,e.target.value)}/></label>;
 return <section className={styles.card}><h2>New appointment</h2><p>Billing address uses the service address. Review the source duplicate check before creating.</p><fieldset disabled={busy||Boolean(receipt)} className={styles.form}>
 <label>Territory<select value={form.franchise} onChange={e=>update('franchise',e.target.value)}>{['New Orleans','Jefferson Parish','Northshore','Baton Rouge'].map(s=><option key={s}>{s}</option>)}</select></label>
 <label>Truck<select value={form.truck} onChange={e=>update('truck',e.target.value)}>{trucks.map(s=><option key={s}>{s}</option>)}</select></label>
 {field('date','Date','date')}{field('startTime','Start time','time')}<label>Duration hours<input type="number" min={1} max={12} value={form.durationHours} onChange={e=>update('durationHours',Number(e.target.value))}/></label>
 <label>Appointment type<select value={form.appointmentType} onChange={e=>update('appointmentType',e.target.value)}><option>Job</option><option>Estimate</option></select></label>
 {field('firstName','First name')}{field('lastName','Last name')}{field('phone','Customer phone','tel')}{field('email','Customer email','email')}{field('serviceAddress','Service address')}{field('serviceZip','Service ZIP')}{field('howHeard','How heard')}{field('scope','Work description')}{field('notes','Notes')}
 <button className={styles.secondary} type="button" onClick={()=>void run(async()=>{requestId.current=crypto.randomUUID();setCheck((await managerRequest('creation-check',payload())).check);})}>Review booking and check duplicates</button>
 {check&&<><p>{check.matches.length?`${check.matches.length} possible existing appointments. Review them before continuing.`:'No matching duplicate in the saved schedule.'}</p>{check.matches.map(match=><article key={match.recordId}><strong>{match.jkNumber} · {match.customerName}</strong><p>{match.appointmentTime} · {match.status} · {match.truck}</p><p>{match.address}</p></article>)}{check.matches.length>0&&<><label><input type="checkbox" checked={separate} onChange={e=>setSeparate(e.target.checked)}/>Create a separate appointment intentionally</label><label>Reason<textarea value={form.duplicateOverrideReason} onChange={e=>setForm({...form,duplicateOverrideReason:e.target.value})}/></label></>}
 <p>{form.firstName} {form.lastName} · {form.date} {form.startTime} · {form.truck}</p><button className={styles.primary} type="button" disabled={check.matches.length>0&&(!separate||form.duplicateOverrideReason.trim().length<10)} onClick={()=>void run(async()=>{if(!window.confirm('Create this reviewed appointment in JunkWare?'))return;setReceipt({requestId:requestId.current,status:'uncertain'});const result=await managerRequest('creation',{...payload(),duplicateReview:{fingerprint:check.fingerprint,createSeparate:separate}});setReceipt(result.receipt);if(result.receipt?.status==='verified')onSaved();})}>Create reviewed appointment</button></>}
 </fieldset>{error&&<p role="alert">{error}</p>}{receipt&&<><p role="status">{receipt.status} · {receipt.result?.jkNumber || receipt.error || 'Check saved result before another booking.'}</p><p>Reference: {receipt.requestId}</p><button className={styles.secondary} disabled={busy} onClick={()=>void run(async()=>{const result=await managerRequest('creation',undefined,{requestId:receipt.requestId});setReceipt(result.receipt);if(result.receipt?.status==='verified')onSaved();})}>Check saved booking</button></>}
 <button className={styles.secondary} disabled={busy} onClick={()=>{if(leave())onClose();}}>Close booking</button></section>;
}
