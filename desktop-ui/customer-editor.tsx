import {useEffect,useRef,useState} from 'react';
import type {ScheduleAppointment} from './lib/schedule-contract';
import {Button} from './components/ui/button';
import {sendScheduleChange,checkScheduleChange,ChangeReceipt,type Receipt} from './schedule-receipt';
import {parseCustomerChange,type CustomerDetails} from '../lib/customer-edit-contract';
type Source={customer:CustomerDetails;sourceVersion:string;protectedVersion:string};
const fields:Array<[keyof CustomerDetails,string,number]>=[['firstName','First name',45],['lastName','Last name',45],['phone','Phone',20],['secondaryPhone','Secondary phone',20],['email','Email',100],['address','Service address',150],['zip','Service ZIP',5]];
export default function CustomerEditor({job,date,saved,onBusyChange,disabled}:{job:ScheduleAppointment;date:string;saved:()=>void;onBusyChange:(value:boolean)=>void;disabled:boolean}) {
  const [source,setSource]=useState<Source|null>(null),[customer,setCustomer]=useState<CustomerDetails|null>(null),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<Receipt|null>(null);
  const pending=useRef(false),storageKey=`ops-customer-edit:${job.appointmentId}`;
  useEffect(()=>{onBusyChange(busy);return()=>onBusyChange(false);},[busy,onBusyChange]);
  useEffect(()=>{const id=localStorage.getItem(storageKey);if(id)setReceipt({requestId:id,status:'uncertain',message:'A previous customer edit needs its saved result checked.'});},[storageKey]);
  const blocked=busy || disabled || Boolean(receipt && ['pending','uncertain'].includes(receipt.status));
  const load=async()=>{
    if(pending.current || blocked)return;pending.current=true;setBusy(true);setError('');
    try{const response=await fetch(`/api/desktop/schedule/customer?appointmentId=${encodeURIComponent(job.appointmentId)}`,{credentials:'same-origin',cache:'no-store'});const body=await response.json();if(!response.ok || !body.customer)throw new Error(body.error || 'Customer details are unavailable.');setSource(body);setCustomer(body.customer);setReview(false);setReceipt(null);}
    catch(e){setError(e instanceof Error?e.message:'Customer details are unavailable.');}finally{pending.current=false;setBusy(false);}
  };
  const accept=(result:Receipt)=>{setReceipt(result);if(['verified','failed','reconciled'].includes(result.status))localStorage.removeItem(storageKey);if(result.status==='verified'){setSource(null);setCustomer(null);saved();}};
  const save=async()=>{
    if(!source || !customer || !review || pending.current || blocked)return;
    const values={customer,expectedSourceVersion:source.sourceVersion,protectedVersion:source.protectedVersion};
    try{parseCustomerChange(values);}catch(e){setError((e as Error).message);setReview(false);return;}
    const requestId=crypto.randomUUID();localStorage.setItem(storageKey,requestId);pending.current=true;setBusy(true);setError('');
    try{accept(await sendScheduleChange(job,date,'customer',values,requestId));}
    catch{setReceipt({requestId,status:'uncertain',message:'The customer save is unconfirmed. Check the saved result before another change.'});}
    finally{pending.current=false;setBusy(false);}
  };
  const check=async()=>{if(pending.current || !receipt)return;pending.current=true;setBusy(true);setError('');try{accept(await checkScheduleChange(receipt.requestId));}catch{setError('The saved result is unavailable. Keep this request and check again.');}finally{pending.current=false;setBusy(false);}};
  return <section className="customer-editor drawer-dispatch-controls" aria-label="Customer information">
    <div className="drawer-control-heading"><strong>Customer information</strong><Button variant="outline" size="sm" disabled={blocked} onClick={()=>void load()}>{busy?'Checking JunkWare…':'Edit Customer'}</Button></div>
    {source && customer && <><p>Edit the customer contact information and this appointment’s service address in JunkWare. Contact changes may also appear on other appointments for this customer.</p>
      <div className="customer-edit-fields">{fields.map(([key,label,max])=><label key={key}><span>{label}</span><input aria-label={label} type={key==='email'?'email':key==='phone' || key==='secondaryPhone'?'tel':'text'} inputMode={key==='zip'?'numeric':undefined} maxLength={max} value={customer[key]} disabled={blocked} onChange={event=>{setCustomer({...customer,[key]:event.target.value});setReview(false);setError('');}}/></label>)}</div>
      {review && <div className="customer-edit-review"><strong>Review customer changes</strong>{fields.filter(([key])=>customer[key]!==source.customer[key]).map(([key,label])=><p key={key}>{label}: {source.customer[key] || '(blank)'} → {customer[key] || '(blank)'}</p>)}</div>}
      <div className="customer-edit-actions"><Button disabled={blocked || JSON.stringify(customer)===JSON.stringify(source.customer)} onClick={()=>{if(review){void save();return;}try{parseCustomerChange({customer,expectedSourceVersion:source.sourceVersion,protectedVersion:source.protectedVersion});setReview(true);setError('');}catch(e){setError((e as Error).message);}}}>{review?'Save Customer in JunkWare':'Review Changes'}</Button><Button variant="outline" disabled={blocked} onClick={()=>{setSource(null);setCustomer(null);setReview(false);}}>Cancel</Button></div>
    </>}
    {error && <p role="alert">{error}</p>}{receipt && <ChangeReceipt receipt={receipt} onCheck={()=>void check()}/>}
  </section>;
}
