'use client';
import { truckDisplayText } from '../../lib/junkware-trucks';
import { useEffect, useRef, useState } from 'react';
import { CREW_PHONE_API, type CrewPhone, type CrewPhoneDay } from '@/lib/crew-phone';
import type { CrewCurrent, CrewScheduledJob } from '@/lib/crew-dispatch';
import styles from './phone-access.module.css';
import JobCloseout from './job-closeout';
import DaySummary,{AddressLink} from './day-summary';
import DailyCrew from './daily-crew';
import SwitchTruck,{type SwitchSummary} from './switch-truck';
import RequestSetupCode from './request-setup-code';
import TruckInspectionApp from '@/components/TruckInspectionApp';
import {chicagoDateKey} from '@/lib/chicago-date';
import { clearCrewCloseoutDrafts, crewCloseoutKey, readCloseoutLocal } from '../../desktop-ui/lib/closeout-drafts';
import type { Receipt } from '../../desktop-ui/schedule-receipt';
import { clearCrewPhotoDrafts } from './job-photos';

const pendingKey = 'ops-crew-phone-enrollment-v1';
type Pending = { code: string; connectionKey: string };
export default function CrewPhoneSetup({ onBusyChange, onStepChange, onTestChange }: { onTestChange?: (test:boolean)=>void; onBusyChange?: (busy: boolean) => void; onStepChange?: (step: 'setup' | 'inspection' | 'jobs') => void }) {
  const [phone, setPhone] = useState<CrewPhone | null>(null);
  const [day,setDay]=useState<CrewPhoneDay|null>(null),[dayDate,setDayDate]=useState(''),[roster,setRoster]=useState<string[]>([]),[editingCrew,setEditingCrew]=useState(false);
  const [trucks,setTrucks]=useState<string[]>([]),[inspectionRequired,setInspectionRequired]=useState(true);
  const [switching,setSwitching]=useState(false),[truckSwitch,setTruckSwitch]=useState<SwitchSummary|null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(()=>{onTestChange?.(phone?.test===true);},[phone?.test,onTestChange]);
  const inFlight = useRef(false);
  const [assignment,setAssignment]=useState<CrewCurrent|null>(null);
  const [jobLoading,setJobLoading]=useState(false);
  const [details,setDetails]=useState(false);
  const [selectedAppointment,setSelectedAppointment]=useState<string|null>(null);
  const [closeout,setCloseout]=useState(false);
  const [pendingCloseout,setPendingCloseout]=useState<{assignmentId:string;requestId?:string}|null>(null);
  const [backgroundNotice,setBackgroundNotice]=useState('');
  const jobRequest=useRef(0);
  const step=!phone || !day || editingCrew || switching ? 'setup' : inspectionRequired ? 'inspection' : 'jobs';
  useEffect(()=>{onStepChange?.(step);},[step,onStepChange]);
  async function loadJob() {
    const request=++jobRequest.current;
    setJobLoading(true);setAssignment(null);setError('');
    try {
      const dayResponse=await fetch('/api/crew-jobs/day',{cache:'no-store'}),dayBody=await dayResponse.json();
      if(request!==jobRequest.current)return;
      if(dayResponse.status===401){setPhone(null);setDay(null);throw new Error(dayBody.error || 'This phone needs manager setup.');}
      if(!dayResponse.ok)throw new Error(dayBody.error || 'Today’s crew could not be loaded.');
      setDay(dayBody.day);setDayDate(dayBody.date);setRoster(dayBody.roster);setTrucks(dayBody.trucks);setEditingCrew(false);
      if(dayBody.phone)setPhone(dayBody.phone);
      setTruckSwitch(dayBody.switch || null);setSwitching(Boolean(dayBody.switch));
      if(dayBody.switch)return;
      setInspectionRequired(dayBody.inspection?.status!=='ready');
      if(!dayBody.day || dayBody.inspection?.status!=='ready')return;
      const response=await fetch('/api/crew-jobs/current',{cache:'no-store'});
      const body=await response.json();
      if(request!==jobRequest.current)return;
      if(response.status===401){void clearCrewPhotoDrafts().catch(()=>{});setJobLoading(false);clearCrewCloseoutDrafts();setDay(null);setPhone(null);throw new Error(body.error || 'This phone needs manager setup.');}
      if(!response.ok)throw new Error(body.error || 'Your assignment could not be verified. Contact dispatch.');
      setAssignment(body);setDetails(false);setCloseout(false);
      if(body.state==='assigned' && body.job && dayBody.phone?.deviceId){
        const saved=readCloseoutLocal<Receipt>(`${crewCloseoutKey(dayBody.phone.deviceId,body.job.assignmentId)}:receipt`);
        if(saved?.status==='pending')setPendingCloseout({assignmentId:body.job.assignmentId,requestId:saved.requestId});
        else if(saved?.status==='uncertain')setBackgroundNotice(saved.message || 'Checkout needs verification. Open the assignment and check the saved result; do not submit it again.');
      }
      // Keep assignment-scoped drafts across truck handoffs and temporary unavailable states.
    }catch(error){if(request===jobRequest.current)setError(error instanceof Error?error.message:'Your assignment could not be verified. Contact dispatch.');}
    finally{if(request===jobRequest.current)setJobLoading(false);}
  }
  useEffect(()=>{
    if(phone)void loadJob();
    return ()=>{jobRequest.current++;};
  },[phone?.deviceId]);
  useEffect(()=>{const resume=()=>{if(document.visibilityState==='visible' && phone && dayDate && dayDate!==chicagoDateKey() && !busy)void loadJob();};document.addEventListener('visibilitychange',resume);return()=>document.removeEventListener('visibilitychange',resume);});
  useEffect(()=>{
    if(!assignment?.completionPending || busy || details)return;
    const timer=setTimeout(()=>void loadJob(),5000);
    return()=>clearTimeout(timer);
  },[assignment,busy,details]);
  useEffect(()=>{
    if(!pendingCloseout?.requestId)return;
    const pending=pendingCloseout as {assignmentId:string;requestId:string};
    let canceled=false,timer:ReturnType<typeof setTimeout>|undefined;
    const check=async()=>{
      try{
        const response=await fetch(`/api/crew-jobs/closeout?assignmentId=${encodeURIComponent(pending.assignmentId)}&requestId=${encodeURIComponent(pending.requestId)}`,{cache:'no-store',signal:AbortSignal.timeout(15_000)});
        const body=await response.json();
        if(canceled)return;
        const receipt=body.receipt as Receipt|undefined;
        if(!response.ok || !receipt)throw new Error(body.error || 'Background checkout status is unavailable.');
        if(receipt.status==='verified'){
          setPendingCloseout(null);setBackgroundNotice('Checkout finished and was verified in JunkWare. Loading the next assignment…');
          await loadJob();return;
        }
        if(receipt.status!=='pending'){
          setPendingCloseout(null);setBackgroundNotice(receipt.message || 'Checkout needs verification. Open the assignment and check the saved result; do not submit it again.');return;
        }
      }catch(error){if(!canceled)setBackgroundNotice(error instanceof Error?error.message:'Background checkout status is unavailable.');}
      if(!canceled)timer=setTimeout(check,3000);
    };
    void check();return()=>{canceled=true;if(timer)clearTimeout(timer);};
  },[pendingCloseout?.assignmentId,pendingCloseout?.requestId]);
  async function refresh() {
    jobRequest.current++;setAssignment(null);setLoading(true); setError('');
    try {
      const response = await fetch(CREW_PHONE_API, { cache: 'no-store' });
      const body = await response.json();
      if (response.status === 401) { void clearCrewPhotoDrafts().catch(()=>{}); clearCrewCloseoutDrafts();setDay(null);setPhone(null); return; }
      if (!response.ok || !body.phone) throw new Error(body.error || 'Phone access could not be verified.');
      setPhone(body.phone);
      // A same-device refresh also needs a new current-assignment read.
      if(phone?.deviceId===body.phone.deviceId)void loadJob();
      try { localStorage.removeItem(pendingKey); } catch { /* Connection is already verified. */ }
    } catch (error) { setError(error instanceof Error ? error.message : 'Phone access could not be verified.'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(pendingKey) || 'null') as Pending | null; if (saved?.code) setCode(saved.code); } catch { /* Setup reports storage failures before enrolling. */ }
    void refresh();
  }, []);
  async function enroll(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const normalized = code.trim();
      let pending: Pending;
      try {
        const existing = JSON.parse(localStorage.getItem(pendingKey) || 'null') as Pending | null;
        pending = existing?.code === normalized && /^[a-f0-9]{64}$/.test(existing.connectionKey) ? existing : {
          code: normalized, connectionKey: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''),
        };
        localStorage.setItem(pendingKey, JSON.stringify(pending));
      } catch { throw new Error('Allow browser storage on this company phone, then try setup again.'); }
      const response = await fetch(CREW_PHONE_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'enroll', ...pending }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Setup could not be confirmed. Retry with this same code.');
      // Read with the cookie before dropping the recovery key or claiming setup.
      const check = await fetch(CREW_PHONE_API, { cache: 'no-store' });
      const saved = await check.json();
      if (!check.ok || saved.phone?.deviceId !== body.phone?.deviceId) throw new Error('The phone connection was not retained. Allow cookies, then retry with this same code.');
      setPhone(saved.phone);
      localStorage.removeItem(pendingKey);
    } catch (error) { setError(error instanceof Error ? error.message : 'Setup could not be confirmed. Retry with this same code.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function disconnect() {
    if(inFlight.current || busy)return;
    inFlight.current=true;setBusy(true);setError('');
    try {
      const response=await fetch(CREW_PHONE_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'disconnect'})});
      if(!response.ok)throw new Error('Disconnect could not be confirmed. Check connection.');
      jobRequest.current++;setAssignment(null);clearCrewCloseoutDrafts();setDay(null);setPhone(null);setDetails(false);
      await clearCrewPhotoDrafts();
    }catch(error){setError(error instanceof Error?error.message:'Disconnect could not be confirmed.');}
    finally{inFlight.current=false;setBusy(false);}
  }
  const jobs:CrewScheduledJob[]=assignment?.jobs || (assignment?.job?[{...assignment.job,status:'Confirmed'}]:[]);
  const viewedJob=jobs.find(job=>job.appointmentId===selectedAppointment) || jobs.find(job=>job.assignmentId===assignment?.job?.assignmentId) || jobs[0];
  if (!loading && phone && day && switching) return <main className={styles.page}><div className={styles.content}><SwitchTruck day={day} trucks={trucks} pending={truckSwitch} onBusy={setBusy} onDone={()=>{setSwitching(false);void loadJob();}} onCancel={()=>setSwitching(false)}/></div></main>;
  if (!loading && phone && day && !editingCrew && inspectionRequired) return <>
    <TruckInspectionApp key={`${phone.deviceId}:${day.date}:${day.version}`} apiPath="/api/crew-jobs/inspection" onBusyChange={setBusy} onContinue={()=>void loadJob()}/>
    <div className={styles.workflowActions}><button className={styles.secondary} disabled={busy || jobLoading} onClick={()=>setSwitching(true)}>Switch truck</button><button className={styles.secondary} disabled={busy || jobLoading} onClick={()=>setEditingCrew(true)}>Edit crew</button><button className={styles.secondary} disabled={busy || jobLoading} onClick={()=>void loadJob()}>Check inspection status</button>{error && <p role="alert">{error}</p>}</div>
  </>;
  return <main className={styles.page}><div className={styles.content}>
    {step!=='jobs' && <p><span className={styles.badge}>{truckDisplayText(day?.truck || 'Company phone')}</span></p>}
    {loading ? <p role="status">Checking this phone…</p> : phone ? <>
      {backgroundNotice && <p className={pendingCloseout?styles.backgroundProgress:styles.backgroundNotice} role={pendingCloseout?'status':'alert'}>{backgroundNotice}</p>}
      {jobLoading ? <p role="status">Loading today’s assignments…</p> : dayDate && (!day || editingCrew) ? <DailyCrew key={`${phone.deviceId}:${dayDate}:${day?.version || 0}`} date={dayDate} roster={roster} trucks={trucks} day={day} onBusy={setBusy} onSaved={()=>void loadJob()} onCancel={()=>setEditingCrew(false)}/> : assignment?.state==='waiting' ? <><h1>Assignments</h1><p>{phone.test?'All three test assignments are complete. You can reset them in Truck & phone.':'No appointments are assigned to this truck today.'}</p></> : assignment?.state==='assigned' && viewedJob ? <>
        <h1>{details?'Assignment details':'Assignments'}</h1>
        {!details ? <><p className={styles.muted}>{truckDisplayText(phone.truck)} · {jobs.length} {jobs.length===1?'appointment':'appointments'} today</p>{jobs.map(job=><section className={styles.card} key={job.appointmentId}><p className={styles.muted}>{job.jkNumber} · {job.appointmentTime} · {job.status}</p><h2>{job.customerName}</h2><p><AddressLink address={job.address}/></p><p>{job.junkItems.join(' · ')}</p>{job.assignmentId && pendingCloseout?.assignmentId===job.assignmentId && <p role="status">Checkout finishing…</p>}<button className={styles.primary} onClick={()=>{setSelectedAppointment(job.appointmentId);setDetails(true);setCloseout(false);}}>View assignment</button></section>)}</> : <section className={`${styles.card} ${closeout ? styles.closeoutCard : ''}`}><p className={styles.muted}>{viewedJob.jkNumber} · {viewedJob.appointmentTime}</p><h2>{viewedJob.customerName}</h2><p><AddressLink address={viewedJob.address}/></p>
          {closeout && viewedJob.assignmentId ? <JobCloseout key={viewedJob.assignmentId} job={{...viewedJob,assignmentId:viewedJob.assignmentId}} truck={phone.truck} deviceId={phone.deviceId} test={phone.test} onBusyChange={setBusy} onBack={()=>setCloseout(false)} onNext={()=>void loadJob()} onHandoffStarted={()=>{setPendingCloseout({assignmentId:viewedJob.assignmentId!});setBackgroundNotice('Checkout is transferring in the background. Keep Waypoint open; you can view your other assignments while it finishes.');setDetails(false);setCloseout(false);}} onHandoffFailed={message=>{setPendingCloseout(null);setBackgroundNotice(message);}} onQueued={requestId=>{setPendingCloseout({assignmentId:viewedJob.assignmentId!,requestId});setBackgroundNotice('Checkout is finishing in the background. You can view your other assignments.');}}/> : <><h2>Items to remove</h2><p>{viewedJob.junkItems.join(', ') || 'See job notes.'}</p><h2>Job notes</h2>{viewedJob.appointmentNotes.length?viewedJob.appointmentNotes.map((note,index)=><p key={index}>{note}</p>):<p>No job notes.</p>}<h2>Assigned crew</h2><p>{viewedJob.driver || day?.driver} · Driver</p><p>{viewedJob.navigator || day?.navigators.join(', ') || 'No navigator'} · Navigator</p>
          {viewedJob.assignmentId && !/^completed$/i.test(viewedJob.status) ? <button className={styles.primary} disabled={busy || pendingCloseout?.assignmentId===viewedJob.assignmentId} onClick={()=>setCloseout(true)}>{pendingCloseout?.assignmentId===viewedJob.assignmentId?'Checkout finishing…':'Start closeout · Before photos'}</button> : <p className={styles.muted}>{/^completed$/i.test(viewedJob.status)?'Completed in JunkWare.':'Closeout is available when dispatch releases this appointment.'}</p>}<button className={styles.secondary} disabled={busy} onClick={()=>setDetails(false)}>Back to Assignments</button></>}
        </section>}
      </> : <><h1>Assignment unavailable</h1><p>{assignment?.message || 'Your assignment could not be verified. Contact dispatch.'}</p></>}
      {step==='jobs' && !details && assignment?.summary && <DaySummary summary={assignment.summary}/>}
      <button className={styles.secondary} onClick={()=>void loadJob()} disabled={jobLoading || busy}>{day?'Refresh assignments':'Refresh setup'}</button>
      {day && !editingCrew && <details className={styles.card}><summary>Truck &amp; phone</summary><h2>{truckDisplayText(day.truck)} · Today’s crew</h2><p>{day.driver} · Driver<br/>{day.navigators.join(', ') || 'No navigator'} · Navigator</p><button className={styles.secondary} disabled={busy || jobLoading} onClick={()=>setSwitching(true)}>Switch truck</button><button className={styles.secondary} disabled={busy || jobLoading} onClick={()=>{setEditingCrew(true);setCloseout(false);}}>Edit crew</button><button className={styles.secondary} disabled={busy || jobLoading} onClick={()=>void disconnect()}>Disconnect company phone</button><button className={styles.secondary} disabled={busy || jobLoading} onClick={()=>void refresh()}>Check connection</button>{phone.test && <button className={styles.secondary} disabled={busy || jobLoading} onClick={async()=>{setBusy(true);try{const response=await fetch('/api/crew-jobs/day',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reset-test-assignments'})});const body=await response.json();if(!response.ok)throw new Error(body.error || 'Reset failed.');await loadJob();}catch(e){setError(e instanceof Error?e.message:'Reset failed.');}finally{setBusy(false);}}}>Reset three test assignments</button>}</details>}
    </> : <><h1>Company phone setup</h1><RequestSetupCode busy={busy} onBusy={setBusy}/><p>Enter the 6-digit code from OpsBot to connect this phone.</p>
      <form className={styles.form} onSubmit={enroll}><label>Setup code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" spellCheck={false} value={code} maxLength={6} onChange={event => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))} required disabled={busy}/></label>
      <button className={styles.primary} disabled={busy || !/^[0-9]{6}$/.test(code.trim())}>{busy ? 'Connecting…' : 'Connect phone'}</button></form>
    </>}
    {phone && !day && <button className={styles.secondary} disabled={busy || jobLoading} onClick={()=>void disconnect()}>Disconnect company phone</button>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!loading && !phone && <button className={styles.secondary} onClick={() => void refresh()} disabled={busy || jobLoading}>Check connection</button>}
  </div></main>;
}
