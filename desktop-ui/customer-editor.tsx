import {useEffect,useRef,useState} from 'react';
import type {ScheduleAppointment} from './lib/schedule-contract';
import {Button} from './components/ui/button';
import {sendScheduleChange,checkScheduleChange,ChangeReceipt,type Receipt} from './schedule-receipt';
import {parseCustomerChange,type CustomerDetails} from '../lib/customer-edit-contract';
type Source={customer:CustomerDetails;sourceVersion:string;protectedVersion:string};
const fields:Array<[keyof CustomerDetails,string,number]>=[['firstName','First name',45],['lastName','Last name',45],['phone','Phone',20],['secondaryPhone','Secondary phone',20],['email','Email',100],['address','Service address',150],['zip','Service ZIP',5]];
export default function CustomerEditor({job,date,saved,onBusyChange,disabled}:{job:ScheduleAppointment;date:string;saved:()=>void;onBusyChange:(value:boolean)=>void;disabled:boolean}) {
  const [source,setSource]=useState<Source|null>(null),[customer,setCustomer]=useState<CustomerDetails|null>(null),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<Receipt|null>(null);
  const pending=useRef(false);
  const [actorKey,setActorKey]=useState(''),[allowed,setAllowed]=useState(true),[otherActor,setOtherActor]=useState(false),[reviewedSource,setReviewedSource]=useState(false);
  const storageKey=actorKey ? `ops-customer-edit:${actorKey}:${job.appointmentId}` : '';
  useEffect(()=>{onBusyChange(busy);return()=>onBusyChange(false);},[busy,onBusyChange]);
  useEffect(()=>{let current=true;void fetch(`/api/desktop/schedule/customer?appointmentId=${encodeURIComponent(job.appointmentId)}&statusOnly=1`,{credentials:'same-origin',cache:'no-store'}).then(async response=>{if(!current)return;if(response.status===403){setAllowed(false);return;}const body=await response.json();if(!response.ok || !body.actorKey)throw new Error();setActorKey(body.actorKey);setOtherActor(Boolean(body.blockedByOtherActor));const id=localStorage.getItem(`ops-customer-edit:${body.actorKey}:${job.appointmentId}`);if(body.pendingReceipt)setReceipt(body.pendingReceipt);else if(id)setReceipt({requestId:id,status:'uncertain',message:'A previous customer edit needs its saved result checked.'});}).catch(()=>{if(current)setError('Customer editing is unavailable. Refresh this appointment and try again.');});return()=>{current=false;};},[job.appointmentId]);
  const blocked=!actorKey || otherActor || busy || disabled || Boolean(receipt && ['pending','uncertain'].includes(receipt.status));
  const load=async()=>{
    if(pending.current || blocked)return;pending.current=true;setBusy(true);setError('');
    try{const response=await fetch(`/api/desktop/schedule/customer?appointmentId=${encodeURIComponent(job.appointmentId)}`,{credentials:'same-origin',cache:'no-store'});const body=await response.json();if(body.pendingReceipt)setReceipt(body.pendingReceipt);if(!response.ok || !body.customer)throw new Error(body.error || 'Customer details are unavailable.');setSource(body);setCustomer(body.customer);setReview(false);setReceipt(null);}
    catch(e){setError(e instanceof Error?e.message:'Customer details are unavailable.');}finally{pending.current=false;setBusy(false);}
  };
  const accept=(result:Receipt)=>{setReceipt(result);if(['verified','failed','reconciled'].includes(result.status))storageKey && localStorage.removeItem(storageKey);if(result.status==='verified'){setSource(null);setCustomer(null);saved();}};
  const save=async()=>{
    if(!source || !customer || !review || pending.current || blocked)return;
    const values={customer,expectedSourceVersion:source.sourceVersion,protectedVersion:source.protectedVersion};
    try{parseCustomerChange(values);}catch(e){setError((e as Error).message);setReview(false);return;}
    const requestId=crypto.randomUUID();localStorage.setItem(storageKey,requestId);pending.current=true;setBusy(true);setError('');
    try{accept(await sendScheduleChange(job,date,'customer',values,requestId));}
    catch{setReceipt({requestId,status:'uncertain',message:'The customer save is unconfirmed. Check the saved result before another change.'});}
    finally{pending.current=false;setBusy(false);}
  };
  const finishReview=async()=>{if(!receipt || !reviewedSource || pending.current)return;pending.current=true;setBusy(true);setError('');try{const response=await fetch('/api/desktop/schedule/operations',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({resolveCustomerRequest:true,reviewedInJunkware:true,requestId:receipt.requestId,date,recordId:job.recordId})});const body=await response.json();if(!response.ok || !body.receipt)throw new Error(body.error || 'Manual review could not be recorded.');accept(body.receipt);setSource(null);setCustomer(null);setReviewedSource(false);saved();}catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}};
  const check=async()=>{if(pending.current || !receipt)return;pending.current=true;setBusy(true);setError('');try{accept(await checkScheduleChange(receipt.requestId));}catch{setError('The saved result is unavailable. Check again, or review the appointment in JunkWare and finish the manual review below.');}finally{pending.current=false;setBusy(false);}};
  if(!allowed)return null;
  return <section className="customer-editor drawer-dispatch-controls" aria-label="Customer information">
    <div className="drawer-control-heading"><strong>Customer information</strong><Button variant="outline" size="sm" disabled={blocked} onClick={()=>void load()}>{busy?'Checking JunkWare…':'Edit Customer'}</Button></div>
    {source && customer && <><p>Edit the customer contact information and this appointment’s service address in JunkWare. Contact changes may also appear on other appointments for this customer.</p>
      <div className="customer-edit-fields">{fields.map(([key,label,max])=><label key={key}><span>{label}</span><input aria-label={label} type={key==='email'?'email':key==='phone' || key==='secondaryPhone'?'tel':'text'} inputMode={key==='zip'?'numeric':undefined} maxLength={max} value={customer[key]} disabled={blocked} onChange={event=>{setCustomer({...customer,[key]:event.target.value});setReview(false);setError('');}}/></label>)}</div>
      {review && <div className="customer-edit-review"><strong>Review customer changes</strong>{fields.filter(([key])=>customer[key]!==source.customer[key]).map(([key,label])=><p key={key}>{label}: {source.customer[key] || '(blank)'} → {customer[key] || '(blank)'}</p>)}</div>}
      <div className="customer-edit-actions"><Button disabled={blocked || JSON.stringify(customer)===JSON.stringify(source.customer)} onClick={()=>{if(review){void save();return;}try{parseCustomerChange({customer,expectedSourceVersion:source.sourceVersion,protectedVersion:source.protectedVersion});setReview(true);setError('');}catch(e){setError((e as Error).message);}}}>{review?'Save Customer in JunkWare':'Review Changes'}</Button><Button variant="outline" disabled={blocked} onClick={()=>{setSource(null);setCustomer(null);setReview(false);}}>Cancel</Button></div>
    </>}
    {otherActor && <p role="status">Another manager has an unverified appointment change. Finish its source review before editing.</p>}
    {receipt?.status==='uncertain' && <div className="customer-edit-review"><a href={`https://junkware.junk-king.com/franchise/appointment.aspx?id=${encodeURIComponent(job.appointmentId)}`} target="_blank" rel="noreferrer">Review appointment in JunkWare</a><p>If the saved result cannot be confirmed, review the customer details, address, schedule, charges and payments in JunkWare before ending this request.</p><label><input type="checkbox" checked={reviewedSource} disabled={busy} onChange={event=>setReviewedSource(event.target.checked)}/> I reviewed this appointment in JunkWare.</label><Button variant="outline" disabled={busy || !reviewedSource} onClick={()=>void finishReview()}>Finish Manual Review</Button></div>}
    {error && <p role="alert">{error}</p>}{receipt && <ChangeReceipt receipt={receipt} onCheck={()=>void check()}/>}
  </section>;
}
