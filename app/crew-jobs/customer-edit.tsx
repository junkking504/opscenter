'use client';
import {useEffect,useRef,useState} from 'react';
import {CUSTOMER_FIELDS,normalizeCustomerFields,customerFieldsMatch,type CustomerFields,type SavedCustomerDetails} from '@/lib/crew-customer-contract';
import styles from './phone-access.module.css';
import editStyles from './customer-edit.module.css';
type Receipt={requestId:string;status:string;message:string;customer?:SavedCustomerDetails};
type Loaded={canWrite:boolean;fields?:CustomerFields;city?:string;state?:string;sourceVersion?:string;jobVersion?:string;crewVersion?:number;pendingReceipt?:Receipt|null;message?:string};
async function api(assignmentId:string,query:Record<string,string>={},body?:Record<string,unknown>){
  const response=await fetch('/api/crew-jobs/customer?'+new URLSearchParams({assignmentId,...query}),{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assignmentId,...body})}:{})}).catch(()=>{throw new Error('Connection interrupted. Check the saved result before trying again.');});
  const value=await response.json();
  if(!response.ok&&!value.receipt)throw Object.assign(new Error(value.error||'Customer information is unavailable. Try again.'),{status:response.status});
  return value;
}
export default function CustomerEdit({assignmentId,deviceId,onBusy,onClose}:{assignmentId:string;deviceId:string;onBusy:(busy:boolean)=>void;onClose:(saved:SavedCustomerDetails|null)=>void}){
  const [loaded,setLoaded]=useState<Loaded|null>(null),[fields,setFields]=useState<CustomerFields|null>(null),[review,setReview]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState(''),[receipt,setReceipt]=useState<Receipt|null>(null),[requestId,setRequestId]=useState('');
  const inFlight=useRef(false),key=`waypoint-customer-receipt:${deviceId}:${assignmentId}`;
  useEffect(()=>{onBusy(true);return()=>onBusy(false);},[onBusy]);
  useEffect(()=>{
    let active=true;
    const start=async()=>{
      const saved=localStorage.getItem(key);
      if(saved){if(active)setRequestId(saved);const result=await api(assignmentId,{requestId:saved});if(active)setReceipt(result.receipt);return;}
      const result:Loaded=await api(assignmentId);
      if(!active)return;setLoaded(result);setFields(result.fields||null);if(result.pendingReceipt){setRequestId(result.pendingReceipt.requestId);setReceipt(result.pendingReceipt);localStorage.setItem(key,result.pendingReceipt.requestId);}
    };
    void start().catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[assignmentId,key]);
  useEffect(()=>{
    if(!requestId || receipt?.status!=='pending')return;
    let active=true;const timer=setInterval(()=>{if(document.visibilityState==='hidden')return;void api(assignmentId,{requestId}).then(result=>{if(active)setReceipt(result.receipt);}).catch(()=>{/* Keep the accepted receipt and manual check available. */});},3000);
    return()=>{active=false;clearInterval(timer);};
  },[assignmentId,requestId,receipt?.status]);
  async function check(){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{const result=await api(assignmentId,{requestId,reconcile:'1'});setReceipt(result.receipt);}catch(e){setError((e as Error).message);}finally{setBusy(false);inFlight.current=false;}}
  async function reload(){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{const result=await api(assignmentId);localStorage.removeItem(key);setRequestId('');setReceipt(null);setReview(false);setLoaded(result);setFields(result.fields||null);if(result.pendingReceipt){setRequestId(result.pendingReceipt.requestId);setReceipt(result.pendingReceipt);localStorage.setItem(key,result.pendingReceipt.requestId);}}catch(e){setError((e as Error).message);}finally{setBusy(false);inFlight.current=false;}}
  async function save(){
    if(inFlight.current || requestId || !loaded?.canWrite || !fields)return;
    inFlight.current=true;setBusy(true);setError('');
    try{const normalized=normalizeCustomerFields(fields),id=crypto.randomUUID();localStorage.setItem(key,id);setRequestId(id);
      const result=await api(assignmentId,{}, {requestId:id,fields:normalized,expectedVersion:loaded.jobVersion,expectedSourceVersion:loaded.sourceVersion,crewVersion:loaded.crewVersion});setReceipt(result.receipt);
    }catch(e){const status=(e as {status?:number}).status;if(status&&status>=400&&status<500){localStorage.removeItem(key);setRequestId('');if([401,403,409].includes(status)){setReview(false);setLoaded(previous=>previous?{...previous,canWrite:false,message:'Reload current customer information before saving again.'}:null);}}setError((e as Error).message);}finally{setBusy(false);inFlight.current=false;}
  }
  const changes=fields&&loaded?.fields?(Object.keys(CUSTOMER_FIELDS) as Array<keyof CustomerFields>).filter(name=>fields[name]!==loaded.fields![name]):[];
  function prepare(){try{const value=normalizeCustomerFields(fields);if(loaded?.fields&&customerFieldsMatch(value,loaded.fields))throw new Error('Make a correction before reviewing.');setFields(value);setReview(true);setError('');}catch(e){setError((e as Error).message);}}
  return <section className={editStyles.editor} aria-labelledby="customer-edit-title">
    <h2 id="customer-edit-title">{receipt?.status==='verified'?'Customer information saved':review?'Review corrections':'Edit Customer Information'}</h2>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    {busy&&<p role="status">{requestId?'Checking saved correction…':'Loading customer information…'}</p>}
    {receipt?<><p role="status">{receipt.message}</p>{receipt.status==='verified'?<p>Your corrections are verified in JunkWare. The route will update when its schedule refreshes.</p>:null}
      {['pending','uncertain'].includes(receipt.status)&&<button className={styles.secondary} disabled={busy} onClick={()=>void check()}>Check saved result</button>}
      {['failed','reconciled'].includes(receipt.status)&&<button className={styles.secondary} disabled={busy} onClick={()=>void reload()}>Reload customer information</button>}
    </>:requestId?<><p>Check whether this correction was accepted before making another change.</p><button className={styles.secondary} disabled={busy} onClick={()=>void check()}>Check saved result</button><button className={styles.secondary} disabled={busy} onClick={()=>void reload()}>Reload current information</button></>:loaded?.canWrite&&fields?<>
      <p>{review?'These changes will be saved to the customer and appointment in JunkWare.':'Correct the details for this appointment. Check the address with the customer before changing it.'}</p>
      {review?<dl className={editStyles.changes}>{changes.map(name=><div key={name}><dt>{CUSTOMER_FIELDS[name]}</dt><dd><span>Current</span>{loaded.fields?.[name]||'Not provided'}</dd><dd><span>Corrected</span><strong>{fields[name]||'Not provided'}</strong></dd></div>)}</dl>:<form className={styles.form} onSubmit={e=>{e.preventDefault();prepare();}} id="customer-correction-form">
        {(['firstName','lastName','phone','alternatePhone','email','serviceAddress','serviceZip','serviceContactName','serviceContactPhone'] as Array<keyof CustomerFields>).map(name=><label key={name}>{CUSTOMER_FIELDS[name]}<input value={fields[name]} onChange={e=>setFields({...fields,[name]:e.target.value})} type={/phone/i.test(name)?'tel':name==='email'?'email':'text'} inputMode={name==='serviceZip'?'numeric':undefined} autoComplete="off" maxLength={name==='serviceAddress'?250:160} required={['firstName','lastName','phone','serviceAddress','serviceZip'].includes(name)}/></label>)}
        <p className={styles.muted}>Current service area: {[loaded.city,loaded.state].filter(Boolean).join(', ')||'See source address'}. ZIP changes are checked by JunkWare.</p>
      </form>}
      {review?<><button className={styles.primary} disabled={busy} onClick={()=>void save()}>Save corrections</button><button className={styles.secondary} disabled={busy} onClick={()=>setReview(false)}>Keep editing</button></>:<button className={styles.primary} type="submit" form="customer-correction-form" disabled={busy||changes.length===0}>Review corrections</button>}
    </>:!busy?<><p>{loaded?.message||'Customer information could not be loaded.'}</p><button className={styles.secondary} onClick={()=>void reload()}>Reload customer information</button></>:null}
    <button className={styles.secondary} disabled={busy} onClick={()=>{if(receipt?.status==='verified'){localStorage.removeItem(key);onClose(receipt.customer||null);}else onClose(null);}}>{receipt?.status==='verified'?'Done':'Back to appointment'}</button>
  </section>;
}
