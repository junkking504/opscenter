import { useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { appointmentCategory, appointmentRegion, appointmentStatus, truckLabel, type ScheduleSnapshot } from './lib/schedule-contract';
import { duplicateBookings, type DuplicateReview } from './lib/duplicate-bookings';
import './schedule-duplicates.css';

export default function ScheduleDuplicates({snapshot,busy,open}:{snapshot:ScheduleSnapshot;busy:boolean;open:(id:string)=>void}) {
  const pairs=duplicateBookings(snapshot.appointments);
  const signature=JSON.stringify(pairs.map(pair=>pair.signature));
  const current=useRef(signature);current.current=signature;
  const writePending=useRef(false);const writeEpoch=useRef(0);
  const [reviews,setReviews]=useState<DuplicateReview[]>([]);
  const [error,setError]=useState('');const [saving,setSaving]=useState('');
  const [confirm,setConfirm]=useState('');const [showKept,setShowKept]=useState(false);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    const abort=new AbortController();let pending=false;
    setReviews([]);setConfirm('');setError('');
    const load=async()=>{
      if(pending||writePending.current||!pairs.length)return;pending=true;const epoch=writeEpoch.current;
      try {
        const response=await fetch('/api/desktop/schedule/duplicates?date='+snapshot.date,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000)])});
        const body=await response.json();if(!response.ok)throw Error(body.error||'Saved reviews are unavailable.');
        if(!abort.signal.aborted&&current.current===signature&&epoch===writeEpoch.current){setReviews(body.reviews);setError('');}
      } catch(failure) {if(!abort.signal.aborted&&epoch===writeEpoch.current){setReviews([]);setError(failure instanceof Error?failure.message:'Saved reviews are unavailable.');}}
      finally {pending=false;}
    };
    void load();const timer=window.setInterval(load,15000);
    return()=>{abort.abort();window.clearInterval(timer);};
  },[snapshot.date,signature,refresh]);
  const reviewFor=(key:string,sig:string)=>reviews.find(review=>review.key===key&&review.signature===sig);
  const kept=pairs.filter(pair=>reviewFor(pair.key,pair.signature)?.decision?.state==='keep_both');
  const visible=pairs.filter(pair=>showKept||reviewFor(pair.key,pair.signature)?.decision?.state!=='keep_both');
  const decide=async(review:DuplicateReview,state:'keep_both'|'review')=>{
    if(busy||writePending.current)return;writePending.current=true;writeEpoch.current++;setSaving(review.key);setError('');const expected=signature;
    try {
      const response=await fetch('/api/desktop/schedule/duplicates',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:snapshot.date,key:review.key,fingerprint:review.fingerprint,state,expectedRevision:review.decision?.revision||null}),signal:AbortSignal.timeout(15000)});
      const body=await response.json();if(!response.ok)throw Error(body.error||'The review was not confirmed.');
      if(current.current===expected)setReviews(values=>[...values.filter(value=>value.key!==review.key),body.review]);
      setConfirm('');
    } catch(failure) {setReviews([]);setError(failure instanceof Error?failure.message:'The review was not confirmed. Refresh before retrying.');}
    finally {writePending.current=false;setSaving('');}
  };
  if(!pairs.length)return <section className="schedule-duplicates duplicate-check-clear" aria-label="Duplicate Booking Check"><header><h2>Duplicate Booking Check</h2><span>No Matches in This Snapshot</span></header></section>;
  return <section className="schedule-duplicates" aria-label="Potential Duplicate Bookings">
    <header><div><h2>Potential Duplicate Bookings <span>{pairs.length-kept.length} Need Review</span></h2><p>Matching customer or phone, same service address, overlapping windows. These may be intentional—not confirmed duplicates.</p></div>{kept.length>0&&<Button variant="outline" size="sm" aria-pressed={showKept} onClick={()=>setShowKept(!showKept)}>{showKept?'Hide':'Show'} {kept.length} Kept Pair{kept.length===1?'':'s'}</Button>}</header>
    {error&&<p role="alert">{error} <Button variant="outline" size="sm" onClick={()=>setRefresh(value=>value+1)}>Refresh Reviews</Button></p>}
    {visible.map(pair=>{const review=reviewFor(pair.key,pair.signature),decision=review?.decision;const isKept=decision?.state==='keep_both';return <article key={pair.key}>
      <div className="duplicate-pair-label"><strong>{isKept?'Both Appointments Kept':'Review Before Dispatch'}</strong><span>{pair.reason}</span></div>
      <div className="duplicate-pair-grid">{pair.jobs.map(job=><div className="duplicate-appointment" key={job.recordId}>
        <div><button className="duplicate-reference" disabled={busy} onClick={()=>open(job.recordId)}>{job.jkNumber||'JK Pending'}</button><span>{appointmentCategory(job)} · {appointmentStatus(job)}</span></div>
        <strong>{job.customerName||'Customer Unavailable'}</strong><span>{job.phone||'Phone Unavailable'}</span>
        <a href={'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(job.address)} target="_blank" rel="noopener noreferrer">{job.address}</a>
        <dl><div><dt>Window</dt><dd>{job.appointmentTime}</dd></div><div><dt>Truck</dt><dd>{truckLabel(job.truck)}</dd></div><div><dt>Service Territory</dt><dd>{appointmentRegion(job).label}</dd></div><div><dt>JunkWare Franchise</dt><dd>{job.sourceTerritory||job.territory||'Unavailable'}</dd></div></dl>
        <div className="duplicate-record-actions"><Button variant="outline" size="sm" disabled={busy} onClick={()=>open(job.recordId)}>Open Appointment</Button>{job.appointmentUrl&&/^https:\/\/junkware\.junk-king\.com\//i.test(job.appointmentUrl)&&<a href={job.appointmentUrl} target="_blank" rel="noopener noreferrer">Review in JunkWare ↗</a>}</div>
      </div>)}</div>
      <footer>{isKept?<><span>Kept by {decision.actor} · {new Date(decision.at).toLocaleString('en-US',{timeZone:'America/Chicago'})}</span><Button variant="outline" size="sm" disabled={busy||!!saving} onClick={()=>decide(review!,'review')}>Reopen Review</Button></>:confirm===pair.key?<><span>I reviewed both appointments and intend to keep both. This saves an OpsCenter decision only.</span><Button size="sm" disabled={busy||!!saving||!review} onClick={()=>decide(review!,'keep_both')}>{saving===pair.key?'Saving…':'Confirm Keep Both'}</Button><Button variant="outline" size="sm" disabled={!!saving} onClick={()=>setConfirm('')}>Back</Button></>:<><span>Nothing is merged, canceled, or reassigned.</span><Button variant="outline" size="sm" disabled={busy||!!saving||!review} onClick={()=>setConfirm(pair.key)}>Keep Both</Button></>}</footer>
    </article>;})}
  </section>;
}
