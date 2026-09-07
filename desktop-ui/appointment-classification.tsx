import {useEffect,useRef,useState} from 'react';
import type {ScheduleAppointment} from './lib/schedule-contract';
import {sendScheduleChange,checkScheduleChange,ChangeReceipt,type Receipt} from './schedule-controls';
import {Button} from './components/ui/button';

export function AppointmentClassification({job,date,saved,onBusyChange}: {job:ScheduleAppointment;date:string;saved:()=>void;onBusyChange:(busy:boolean)=>void}) {
  const [source,setSource]=useState<{sourceVersion:string;canWrite:boolean;closeout:{discount:string;truck:string;truckOptions:Array<{value:string;label:string}>;appointmentType:{label:string};status:{value:string;label:string}}}|null>(null);
  const [truck,setTruck]=useState('');
  const [reason,setReason]=useState(''),[explanation,setExplanation]=useState(''),[noDiscountReason,setNoDiscountReason]=useState('');
  const [type,setType]=useState('Job'),[complete,setComplete]=useState(false),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<Receipt|null>(null);
  const pending=useRef(false);
  useEffect(()=>{onBusyChange(busy);return()=>onBusyChange(false);},[busy,onBusyChange]);
  if (/cancel/i.test(job.status)) return null;
  const load=async()=>{
    if(pending.current || receipt && ['pending','uncertain'].includes(receipt.status))return;
    pending.current=true;setBusy(true);setError('');
    try {
      const response=await fetch(`/api/desktop/schedule/classification?appointmentId=${encodeURIComponent(job.appointmentId)}`,{credentials:'same-origin',cache:'no-store'});
      const body=await response.json();if(!response.ok || !body.closeout?.appointmentType)throw new Error(body.error || 'Current appointment type is unavailable.');
      setSource(body);setTruck('');setReason('');setExplanation('');setNoDiscountReason('');setType(body.closeout.appointmentType.label);setComplete(false);setReview(false);setReceipt(null);
    }catch(error){setError(error instanceof Error?error.message:'Could not read the source appointment.');}
    finally{pending.current=false;setBusy(false);}
  };
  const save=async()=>{
    if(!source || !review || pending.current || receipt)return;
    pending.current=true;setBusy(true);const requestId=crypto.randomUUID();
    try {
      const result=await sendScheduleChange(job,date,'classify',{appointmentType:type,completeEstimate:complete,expectedSourceVersion:source.sourceVersion,...(truck ? {truck} : {}),...(needsOutcome ? {estimateOutcome:{reason,explanation,...(needsNoDiscountReason ? {noDiscountReason} : {})}} : {})},requestId);
      setReceipt(result);if(result.status==='verified'){setSource(null);saved();}
    }catch{setReceipt({requestId,status:'uncertain',message:'The source result is unconfirmed. Check the saved result before another change.'});}
    finally{pending.current=false;setBusy(false);}
  };
  const needsTruck=Boolean(source && !source.closeout.truck && (complete || source.closeout.status.value==='8'));
  const needsOutcome=Boolean(source && type==='Estimate' && (complete || source.closeout.status.value==='8'));
  const needsNoDiscountReason=needsOutcome && !(Number(String(source?.closeout.discount || '').replace(/[^0-9.-]/g,'')) > 0);
  return <section className="appointment-type-control" aria-label="Change appointment type">
    <div><strong>Appointment type</strong> <span>{job.appointmentType}</span> <Button size="sm" variant="outline" disabled={busy || Boolean(receipt && ['pending','uncertain'].includes(receipt.status))} onClick={()=>void load()}>{busy?'Checking JunkWare…':'Change Job / Estimate'}</Button></div>
    {source && <><p>JunkWare: {source.closeout.appointmentType.label} · {source.closeout.status.label}</p><label>New appointment type <select aria-label="New appointment type" value={type} disabled={busy || !source.canWrite} onChange={event=>{setType(event.target.value);setComplete(false);setTruck('');setReview(false);setReceipt(null);}}><option>Job</option><option>Estimate</option></select></label>
      {type==='Estimate' && source.closeout.status.value !== '8' && <label><input type="checkbox" checked={complete} disabled={busy || !source.canWrite} onChange={event=>{setComplete(event.target.checked);if(!event.target.checked)setTruck('');setReview(false);}}/> Mark estimate completed</label>}
      {needsTruck && <label>Truck for completion <select aria-label="Truck for completion" value={truck} disabled={busy || !source.canWrite} onChange={event=>{setTruck(event.target.value);setReview(false);}}><option value="">Select truck</option>{source.closeout.truckOptions.filter(option=>/^Truck#?\s*\d+$/i.test(option.label)).map(option=><option key={option.value} value={option.label.replace(/Truck#?\s*/i,'Truck ').trim()}>{option.label}</option>)}</select></label>}
      {needsOutcome && <div className="estimate-outcome-fields">
        <label>Why did this remain an estimate? <select aria-label="Estimate outcome reason" value={reason} disabled={busy || !source.canWrite} onChange={event=>{setReason(event.target.value);setReview(false);}}><option value="">Select reason</option><option>Price/Budget</option><option>Date/Time</option><option>Other</option></select></label>
        <label>Outcome notes <textarea aria-label="Estimate outcome notes" maxLength={2000} rows={2} value={explanation} disabled={busy || !source.canWrite} onChange={event=>{setExplanation(event.target.value);setReview(false);}}/></label>
        {needsNoDiscountReason && <label>Why was no discount offered? <textarea aria-label="No discount explanation" maxLength={2000} rows={2} value={noDiscountReason} disabled={busy || !source.canWrite} onChange={event=>{setNoDiscountReason(event.target.value);setReview(false);}}/></label>}
      </div>}
      <p>{source.closeout.appointmentType.label} / {source.closeout.status.label} → {type} / {complete?'Completed':source.closeout.status.label}{truck ? ` · Set completion truck to ${truck}` : ''}. Existing crew, charges, and payments will be preserved.</p>
      {!review ? <Button size="sm" disabled={busy || !source.canWrite || needsTruck && !truck || needsOutcome && (!reason || !explanation.trim()) || needsNoDiscountReason && !noDiscountReason.trim() || type===source.closeout.appointmentType.label && !complete} onClick={()=>setReview(true)}>Review type change</Button> : <Button size="sm" disabled={busy || Boolean(receipt)} onClick={()=>void save()}>Save type in JunkWare</Button>}
    </>}
    {error && <p role="alert">{error}</p>}{receipt && <ChangeReceipt receipt={receipt} onCheck={()=>void checkScheduleChange(receipt.requestId).then(result=>{setReceipt(result);if(result.status==='verified')saved();}).catch(()=>setError('Saved result is unavailable. Do not repeat the change.'))}/>}
  </section>;
}
