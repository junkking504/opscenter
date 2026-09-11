import {useEffect,useRef,useState} from 'react';
import {Button} from './components/ui/button';
import {ChangeReceipt,checkScheduleChange,sendScheduleChange,type Receipt} from './schedule-controls';
import {assignmentNeedsVerification,isClosed,scheduleMoveWindow,truckLabel,type ScheduleAppointment} from './lib/schedule-contract';

export function AppointmentReschedule({job,date,saved,onBusyChange,onOpenDate}:{job:ScheduleAppointment;date:string;saved:(destination:string)=>void;onBusyChange:(busy:boolean)=>void;onOpenDate?:(date:string)=>void}) {
  const [destination,setDestination]=useState(date);
  const [start,setStart]=useState(job.appointmentStartMinutes===null?'':String(job.appointmentStartMinutes));
  const [review,setReview]=useState(false);
  const [busy,setBusy]=useState(false);
  const [receipt,setReceipt]=useState<Receipt|null>(null);
  const [error,setError]=useState('');
  const inFlight=useRef(false);
  useEffect(()=>{onBusyChange(busy);return()=>onBusyChange(false);},[busy,onBusyChange]);
  const duration=job.appointmentStartMinutes===null || job.appointmentEndMinutes===null?0:job.appointmentEndMinutes-job.appointmentStartMinutes;
  const validDate=/^\d{4}-\d{2}-\d{2}$/.test(destination) && Number.isFinite(Date.parse(destination)) && new Date(destination+'T12:00:00Z').toISOString().slice(0,10)===destination;
  const valid=validDate && start!=='' && Number(start)%60===0 && duration>0 && duration<=720 && duration%60===0 && Number(start)+duration<=1440 && (destination!==date || Number(start)!==job.appointmentStartMinutes);
  const blocked=busy || Boolean(receipt && receipt.status!=='failed') || assignmentNeedsVerification(job);
  const confirm=async()=>{
    if(inFlight.current || blocked || !valid) return;
    inFlight.current=true;setBusy(true);setError('');
    const requestId=crypto.randomUUID();
    try {
      const result=await sendScheduleChange(job,date,'reschedule',{destinationDate:destination,appointmentStartMinutes:Number(start)},requestId);
      setReceipt(result);
      if(result.status==='verified') saved(destination);
    } catch(error) {setReceipt({requestId,status:'uncertain',message:error instanceof Error?error.message:'Check the saved result before trying again.'});}
    finally{setBusy(false);inFlight.current=false;}
  };
  if(isClosed(job)) return null;
  return <section id="appointment-reschedule" className="drawer-reschedule" aria-label="Reschedule Appointment">
    <h3>Reschedule Appointment</h3>
    <p>Current: {date} · {job.appointmentTime} · {truckLabel(job.truck)}</p>
    <div className="drawer-control-fields">
      <label><span>New Appointment Date</span><input id="appointment-reschedule-date" type="date" value={destination} disabled={blocked} onChange={event=>{setDestination(event.target.value);setReview(false);setReceipt(null);}} /></label>
      <label><span>New Appointment Window</span><select value={start} disabled={blocked} onChange={event=>{setStart(event.target.value);setReview(false);setReceipt(null);}}>
        {start==='' && <option value="">Choose time</option>}
        {job.appointmentStartMinutes!==null && job.appointmentStartMinutes%60!==0 && <option value={job.appointmentStartMinutes}>{job.appointmentTime}</option>}
        {Array.from({length:24},(_,i)=>i*60).filter(value=>duration>0 && value+duration<=1440).map(value=><option key={value} value={value}>{scheduleMoveWindow(job,value).label}</option>)}
      </select></label>
    </div>
    <p>The truck and appointment length stay the same. Customer and Krewe messages are separate.</p>
    {(!duration || duration%60!==0) && <p role="alert">The source appointment window needs review in JunkWare before rescheduling.</p>}
    {assignmentNeedsVerification(job) && <p role="alert">Check the unverified assignment change before rescheduling.</p>}
    {!review && !receipt && <Button variant="outline" disabled={blocked || !valid} onClick={()=>setReview(true)}>Review Reschedule</Button>}
    {review && !receipt && <div className="drawer-reschedule-review" role="group" aria-label="Review reschedule">
      <strong>{job.jkNumber} · {job.customerName}</strong>
      <p>From {date} · {job.appointmentTime}<br/>To {destination} · {scheduleMoveWindow(job,Number(start)).label}</p>
      <p>Confirming changes this appointment in JunkWare.</p>
      <div className="drawer-quick-actions"><Button variant="outline" disabled={busy} onClick={()=>setReview(false)}>Keep Appointment</Button><Button disabled={blocked || !valid} onClick={()=>void confirm()}>{busy?'Verifying in JunkWare…':'Confirm Reschedule'}</Button></div>
    </div>}
    {receipt && <ChangeReceipt receipt={receipt} onCheck={()=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);void checkScheduleChange(receipt.requestId).then(value=>{setReceipt(value);if(value.status==='verified')saved(destination);}).catch(error=>setError(error.message)).finally(()=>{setBusy(false);inFlight.current=false;});}}/>}
    {receipt?.status==='failed' && <Button variant="outline" onClick={()=>{setReceipt(null);setReview(false);}}>Review and Correct</Button>}
    {receipt?.status==='verified' && <><p>The reschedule is verified. The day lists are refreshing from JunkWare.</p>{onOpenDate && <Button onClick={()=>onOpenDate(destination)}>View Rescheduled Day →</Button>}</>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
