'use client';
import { truckDisplayText } from '../../lib/junkware-trucks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CREW_PHONE_API, type CrewPhone, type CrewPhoneDay } from '@/lib/crew-phone';
import type { CrewCurrent, CrewScheduledJob } from '@/lib/crew-dispatch';
import styles from './phone-access.module.css';
import {createWaypointViewGuard} from './view-guard';
import JobCloseout from './job-closeout';
import AssignmentOutcome from './assignment-outcome';
import DaySummary,{AddressLink} from './day-summary';
import CustomerPhoneLink from './customer-phone-link';
import DailyCrew from './daily-crew';
import SwitchTruck,{type SwitchSummary} from './switch-truck';
import RequestSetupCode from './request-setup-code';
import TruckInspectionApp from '@/components/TruckInspectionApp';
import {chicagoDateKey} from '@/lib/chicago-date';
import { clearCrewCloseoutDrafts, crewCloseoutKey, readCloseoutLocal, writeCloseoutLocal } from '../../desktop-ui/lib/closeout-drafts';
import type { Receipt } from '../../desktop-ui/schedule-receipt';
import { clearCrewPhotoDrafts } from './job-photos';
import {HANDOFF_EVENT,readHandoffs,retireHandoff,resumeHandoff,saveHandoff,type CheckoutHandoff} from './checkout-handoff';

const pendingKey = 'ops-crew-phone-enrollment-v1';
type Pending = { code: string; connectionKey: string };
export default function CrewPhoneSetup({ onBusyChange, onStepChange, onTestChange }: { onTestChange?: (test:boolean)=>void; onBusyChange?: (busy: boolean) => void; onStepChange?: (step: 'setup' | 'inspection' | 'jobs') => void }) {
  const [viewGuard]=useState(createWaypointViewGuard);
  const [phone, setPhone] = useState<CrewPhone | null>(null);
  const [day,setDay]=useState<CrewPhoneDay|null>(null),[dayDate,setDayDate]=useState(''),[roster,setRoster]=useState<string[]>([]),[editingCrew,setEditingCrewState]=useState(false);
  const [trucks,setTrucks]=useState<string[]>([]),[inspectionRequired,setInspectionRequired]=useState(true);
  const [switching,setSwitchingState]=useState(false),[truckSwitch,setTruckSwitch]=useState<SwitchSummary|null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(()=>{onTestChange?.(phone?.test===true);},[phone?.test,onTestChange]);
  const inFlight = useRef(false);
  const [readyDevice,setReadyDevice]=useState('');
  const [assignment,setAssignment]=useState<CrewCurrent|null>(null);
  const [jobLoading,setJobLoading]=useState(false);
  const [details,setDetailsState]=useState(false);
  const [selectedAppointment,setSelectedAppointmentState]=useState<string|null>(null);
  const [closeout,setCloseout]=useState(false);
  const [pendingCloseout,setPendingCloseout]=useState<{assignmentId:string;requestId?:string}|null>(null);
  const [backgroundNotice,setBackgroundNotice]=useState('');
  const [handoff,setHandoff]=useState<CheckoutHandoff|null>(null);
  const jobRequest=useRef(0);
  const assignmentUpdateToken=useRef('');
  const invalidatedAssignmentIds=useRef<Set<string>>(new Set());
  const backgroundNoticeAssignment=useRef('');
  const showBackgroundNotice=(message:string,assignmentId='')=>{
    backgroundNoticeAssignment.current=assignmentId;
    setBackgroundNotice(message);
  };
  const setBusy=useCallback((value:boolean)=>{viewGuard.set('busy',value);setBusyState(value);},[viewGuard]);
  const setDetails=useCallback((value:boolean)=>{viewGuard.set('details',value);setDetailsState(value);},[viewGuard]);
  const setSwitching=useCallback((value:boolean)=>{viewGuard.set('switching',value);setSwitchingState(value);},[viewGuard]);
  const setEditingCrew=useCallback((value:boolean)=>{viewGuard.set('editingCrew',value);setEditingCrewState(value);},[viewGuard]);
  const setSelectedAppointment=(value:string|null)=>{viewGuard.select(value);setSelectedAppointmentState(value);};
  const step=!phone || !day || editingCrew || switching ? 'setup' : inspectionRequired ? 'inspection' : 'jobs';
  useEffect(()=>{onStepChange?.(step);},[step,onStepChange]);
  async function loadJob() {
    if(viewGuard.blocked()){viewGuard.defer();return;}
    const request=++jobRequest.current,viewVersion=viewGuard.version();
    const current=()=>{
      if(request!==jobRequest.current)return false;
      if(!viewGuard.current(viewVersion)){viewGuard.defer();return false;}
      return true;
    };
    setJobLoading(true);setError('');
    try {
      const dayResponse=await fetch('/api/crew-jobs/day',{cache:'no-store'}),dayBody=await dayResponse.json();
      if(!current())return;
      if(dayResponse.status===401){setPhone(null);setDay(null);throw new Error(dayBody.error || 'This phone needs manager setup.');}
      if(!dayResponse.ok)throw new Error(dayBody.error || 'Today’s crew could not be loaded.');
      let body:CrewCurrent|null=null;
      if(dayBody.day && dayBody.inspection?.status==='ready' && !dayBody.switch){
        const response=await fetch('/api/crew-jobs/current',{cache:'no-store'});
        const result=await response.json();
        if(!current())return;
        if(response.status===401){setDay(null);setPhone(null);throw new Error(result.error || 'This phone needs manager setup.');}
        if(!response.ok)throw new Error(result.error || 'Your assignment could not be verified. Contact dispatch.');
        body=result;
      }
      if(!current())return;
      setDay(dayBody.day);setDayDate(dayBody.date);setRoster(dayBody.roster);setTrucks(dayBody.trucks);
      if(dayBody.phone)setPhone(dayBody.phone);
      setTruckSwitch(dayBody.switch || null);setSwitching(Boolean(dayBody.switch));
      setInspectionRequired(dayBody.inspection?.status!=='ready');
      if(!body)return;
      assignmentUpdateToken.current=String(body.updateToken || '');
      const invalidated=new Set<string>((body.jobs || []).flatMap(job=>job.resetPriorAssignmentId?[job.resetPriorAssignmentId]:[]));
      invalidatedAssignmentIds.current=invalidated;
      // Retired submissions cannot resume, but their draft/photo evidence stays
      // intact. The explicit reset epoch selects a fresh appointment draft.
      for(const id of invalidated){
        if(dayBody.phone?.deviceId)retireHandoff(dayBody.phone.deviceId,id);
        setHandoff(value=>value?.assignmentId===id?null:value);
        setPendingCloseout(value=>value?.assignmentId===id?null:value);
        if(backgroundNoticeAssignment.current===id)showBackgroundNotice('');
      }
      setAssignment(body);setReadyDevice(dayBody.phone?.deviceId || '');
      if(body.state==='assigned' && body.job && dayBody.phone?.deviceId){
        const saved=readCloseoutLocal<Receipt>(`${crewCloseoutKey(dayBody.phone.deviceId,body.job.assignmentId)}:receipt`);
        if(saved?.status==='pending')setPendingCloseout({assignmentId:body.job.assignmentId,requestId:saved.requestId});
        else if(saved?.status==='uncertain')showBackgroundNotice(saved.message || 'Checkout needs verification. Open the assignment and check the saved result; do not submit it again.',body.job.assignmentId);
      }
    }catch(error){if(current())setError(error instanceof Error?error.message:'Your assignment could not be verified. Contact dispatch.');}
    finally{if(request===jobRequest.current)setJobLoading(false);}
  }
  useEffect(()=>{if(viewGuard.takeRefresh())void loadJob();},[details,busy,editingCrew,switching]);
  useEffect(()=>{
    if(phone)void loadJob();
    return ()=>{jobRequest.current++;};
  },[phone?.deviceId]);
  useEffect(()=>{
    if(!phone || phone.test || readyDevice!==phone.deviceId)return;
    const show=(value:CheckoutHandoff)=>{
      if(value.deviceId!==phone.deviceId)return;
      if(invalidatedAssignmentIds.current.has(value.assignmentId)){
        try{retireHandoff(value.deviceId,value.assignmentId);}catch{showBackgroundNotice('The retired checkout is preserved, but phone storage needs attention. Contact the office.',value.assignmentId);}
        setHandoff(current=>current?.assignmentId===value.assignmentId?null:current);
        setPendingCloseout(current=>current?.assignmentId===value.assignmentId?null:current);
        if(backgroundNoticeAssignment.current===value.assignmentId)showBackgroundNotice('');
        return;
      }
      setHandoff(value);showBackgroundNotice(value.message,value.assignmentId);
      if(value.phase==='transferring' || value.phase==='submitting')setPendingCloseout({assignmentId:value.assignmentId});
      else if(value.receipt?.status==='pending')setPendingCloseout({assignmentId:value.assignmentId,requestId:value.requestId});
      else setPendingCloseout(null);
    };
    const resume=()=>{
      if(document.visibilityState==='hidden')return;
      try{
        const latest=readHandoffs(phone.deviceId).filter(value=>!invalidatedAssignmentIds.current.has(value.assignmentId)).sort((a,b)=>b.createdAt-a.createdAt)[0];
        if(!latest)return;
        show(latest);
        if(['transferring','submitting'].includes(latest.phase) && !invalidatedAssignmentIds.current.has(latest.assignmentId))void resumeHandoff(latest).catch(()=>showBackgroundNotice('Phone storage is unavailable. Keep this phone and ask the office to check the saved checkout.',latest.assignmentId));
      }catch{showBackgroundNotice('Saved checkout storage is unavailable on this phone. Contact the office before submitting again.');}
    };
    const changed=(event:Event)=>show((event as CustomEvent<CheckoutHandoff>).detail);
    window.addEventListener(HANDOFF_EVENT,changed);window.addEventListener('online',resume);
    document.addEventListener('visibilitychange',resume);resume();
    return()=>{window.removeEventListener(HANDOFF_EVENT,changed);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);};
  },[phone?.deviceId,phone?.test,readyDevice]);
  useEffect(()=>{const resume=()=>{if(document.visibilityState==='visible' && phone && dayDate && dayDate!==chicagoDateKey() && !busy)void loadJob();};document.addEventListener('visibilitychange',resume);return()=>document.removeEventListener('visibilitychange',resume);});
  const phoneDeviceId=phone?.deviceId,phoneTest=phone?.test===true,dayVersion=day?.version;
  useEffect(()=>{
    if(!phoneDeviceId || phoneTest || !dayVersion || inspectionRequired || busy || details || switching || pendingCloseout)return;
    let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
    const check=async()=>{
      if(document.visibilityState==='visible')try{
        const response=await fetch('/api/crew-jobs/updates',{cache:'no-store',signal:AbortSignal.timeout(10_000)});
        const body=await response.json();
        if(stopped)return;
        if(viewGuard.blocked()){viewGuard.defer();return;}
        if(response.status===401){jobRequest.current++;setAssignment(null);setDay(null);setPhone(null);return;}
        // Metrics can finish syncing after assignment status has stopped changing.
        // Refresh the scoped totals in place without resetting the assignment view.
        if(response.ok && body.summary)setAssignment(current=>current && current.truck===body.summary.truck && body.summary.date===dayDate?{...current,summary:body.summary}:current);
        if(response.ok && body.updateToken && assignmentUpdateToken.current && body.updateToken!==assignmentUpdateToken.current)await loadJob();
        else if(response.ok && body.updateToken && !assignmentUpdateToken.current)assignmentUpdateToken.current=body.updateToken;
      }catch{/* Manual refresh remains available during a temporary connection failure. */}
      if(!stopped)timer=setTimeout(check,3000);
    };
    timer=setTimeout(check,3000);
    return()=>{stopped=true;if(timer)clearTimeout(timer);};
  },[phoneDeviceId,phoneTest,dayVersion,dayDate,inspectionRequired,busy,details,switching,pendingCloseout]);
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
        if(receipt.status!=='pending' && phone){
          writeCloseoutLocal(`${crewCloseoutKey(phone.deviceId,pending.assignmentId)}:receipt`,receipt);
          const saved=readHandoffs(phone.deviceId).find(value=>value.requestId===pending.requestId);
          if(saved)saveHandoff({...saved,receipt,phase:receipt.status==='verified'?'accepted':'attention',message:receipt.status==='verified'?'Closed out · verified in JunkWare.':`Server saved this checkout, but JunkWare needs review. ${receipt.message} Do not submit another payment.`});
        }
        if(receipt.status==='verified'){
          setPendingCloseout(null);showBackgroundNotice('Checkout finished and was verified in JunkWare.',pending.assignmentId);
          await loadJob();return;
        }
        if(receipt.status!=='pending'){
          setPendingCloseout(null);showBackgroundNotice(receipt.message || 'Checkout needs verification. Open the assignment and check the saved result; do not submit it again.',pending.assignmentId);return;
        }
      }catch(error){if(!canceled)showBackgroundNotice(error instanceof Error?error.message:'Background checkout status is unavailable.',pending.assignmentId);}
      if(!canceled)timer=setTimeout(check,3000);
    };
    void check();return()=>{canceled=true;if(timer)clearTimeout(timer);};
  },[pendingCloseout?.assignmentId,pendingCloseout?.requestId]);
  async function refresh() {
    if(viewGuard.blocked()){viewGuard.defer();return;}
    const request=++jobRequest.current,viewVersion=viewGuard.version();setLoading(true);setError('');
    try {
      const response = await fetch(CREW_PHONE_API, { cache: 'no-store' });
      const body = await response.json();
      if(request!==jobRequest.current)return;
      if(!viewGuard.current(viewVersion)){viewGuard.defer();return;}
      if (response.status === 401) { setDay(null);setPhone(null); return; }
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
    if(inFlight.current || busy || pendingCloseout)return;
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
    <div className={styles.workflowActions}><button className={styles.secondary} disabled={busy || jobLoading || Boolean(pendingCloseout)} onClick={()=>{setDetails(false);setCloseout(false);setSwitching(true);}}>Switch truck</button><button className={styles.secondary} disabled={busy || jobLoading || Boolean(pendingCloseout)} onClick={()=>setEditingCrew(true)}>Edit crew</button><button className={styles.secondary} disabled={busy || jobLoading} onClick={()=>void loadJob()}>Check inspection status</button>{error && <p role="alert">{error}</p>}</div>
  </>;
  return <main className={styles.page}><div className={styles.content}>
    {step!=='jobs' && <p><span className={styles.badge}>{truckDisplayText(day?.truck || 'Company phone')}</span></p>}
    {loading ? <p role="status">Checking this phone…</p> : phone ? <>
      {backgroundNotice && <p className={pendingCloseout?styles.backgroundProgress:styles.backgroundNotice} role={pendingCloseout?'status':'alert'}>{backgroundNotice}</p>}
      {handoff && ['transferring','submitting'].includes(handoff.phase) && <button className={styles.secondary} onClick={()=>void resumeHandoff(handoff).catch(()=>showBackgroundNotice('Phone storage is unavailable. Keep this phone and ask the office to check the saved checkout.',handoff.assignmentId))}>Resume transfer</button>}
      {jobLoading ? <p role="status">Loading today’s assignments…</p> : dayDate && (!day || editingCrew) ? <DailyCrew key={`${phone.deviceId}:${dayDate}:${day?.version || 0}`} date={dayDate} roster={roster} trucks={trucks} day={day} onBusy={setBusy} onSaved={()=>{setEditingCrew(false);void loadJob();}} onCancel={()=>setEditingCrew(false)}/> : assignment?.state==='waiting' ? <><h1>Assignments</h1><p>{phone.test?'All three test assignments are complete. You can reset them in Truck & phone.':'No appointments are assigned to this truck today.'}</p></> : assignment?.state==='assigned' && viewedJob ? <>
        <h1>{details?'Assignment details':'Assignments'}</h1>
        {!details ? <><p className={styles.muted}>{truckDisplayText(phone.truck)} · {jobs.length} {jobs.length===1?'appointment':'appointments'} today</p>{jobs.map(job=><section className={styles.card} key={job.appointmentId}><p className={styles.muted}>{job.jkNumber} · {job.appointmentTime} · {job.status}</p><h2>{job.customerName}</h2><p><CustomerPhoneLink phone={job.phone}/></p><AssignmentOutcome job={job}/><p><AddressLink address={job.address}/></p><p>{job.junkItems.join(' · ') || job.appointmentNotes.find(note=>/^Work:/i.test(note))?.replace(/^Work:\s*/i,'').split(/\s+\(\d{1,2}\//)[0]}</p>{job.assignmentId && pendingCloseout?.assignmentId===job.assignmentId && <p role="status">{pendingCloseout.requestId?'Server saved · verification pending':'Securing checkout on the server'}</p>}<button className={styles.primary} onClick={()=>{setSelectedAppointment(job.appointmentId);setDetails(true);setCloseout(false);}}>View assignment</button></section>)}</> : <section className={`${styles.card} ${closeout ? styles.closeoutCard : ''}`}><p className={styles.muted}>{viewedJob.jkNumber} · {viewedJob.appointmentTime}</p><h2>{viewedJob.customerName}</h2><p><CustomerPhoneLink phone={viewedJob.phone}/></p><AssignmentOutcome job={viewedJob} details/><p><AddressLink address={viewedJob.address}/></p>
          {closeout && viewedJob.assignmentId ? <JobCloseout key={viewedJob.assignmentId} job={{...viewedJob,assignmentId:viewedJob.assignmentId}} truck={phone.truck} deviceId={phone.deviceId} test={phone.test} onBusyChange={setBusy} onBack={()=>setCloseout(false)} onNext={()=>{setDetails(false);setCloseout(false);void loadJob();}} onAccepted={(receipt,receiptAssignmentId)=>{
            setPendingCloseout(receipt.status==='pending'?{assignmentId:receiptAssignmentId,requestId:receipt.requestId}:null);
            showBackgroundNotice(receipt.status==='verified'?'Checkout finished and was verified in JunkWare.':'Checkout accepted by the server. JunkWare verification is still pending.',viewedJob.assignmentId!);
            if(viewGuard.selected()===viewedJob.appointmentId){setDetails(false);setCloseout(false);}
            void loadJob();
          }} onHandoffFailed={message=>{setPendingCloseout(null);showBackgroundNotice(message,viewedJob.assignmentId!);}}/> : <><h2>Items to remove</h2><p>{viewedJob.junkItems.join(', ') || 'See job notes.'}</p><h2>Job notes</h2>{viewedJob.appointmentNotes.length?viewedJob.appointmentNotes.map((note,index)=><p key={index}>{note}</p>):<p>No job notes.</p>}<h2>Assigned crew</h2><p>{viewedJob.driver || day?.driver} · Driver</p><p>{viewedJob.navigator || day?.navigators.join(', ') || 'No navigator'} · Navigator</p>
          {viewedJob.assignmentId && !/^completed$/i.test(viewedJob.status) ? <button className={styles.primary} disabled={busy} onClick={()=>setCloseout(true)}>{pendingCloseout?.assignmentId===viewedJob.assignmentId?'Check saved checkout':'Start closeout · Before photos'}</button> : <p className={styles.muted}>{/^completed$/i.test(viewedJob.status)?'Completed in JunkWare.':'Closeout is available when dispatch releases this appointment.'}</p>}<button className={styles.secondary} disabled={busy} onClick={()=>setDetails(false)}>Back to Assignments</button></>}
        </section>}
      </> : <><h1>Assignment unavailable</h1><p>{assignment?.message || 'Your assignment could not be verified. Contact dispatch.'}</p></>}
      {step==='jobs' && !details && assignment?.summary && <DaySummary summary={assignment.summary}/>}
      <button className={styles.secondary} onClick={()=>void loadJob()} disabled={jobLoading || busy}>{day?'Refresh assignments':'Refresh setup'}</button>
      {day && !editingCrew && <details className={styles.card}><summary>Truck &amp; phone</summary><h2>{truckDisplayText(day.truck)} · Today’s crew</h2><p>{day.driver} · Driver<br/>{day.navigators.join(', ') || 'No navigator'} · Navigator</p><button className={styles.secondary} disabled={busy || jobLoading || Boolean(pendingCloseout)} onClick={()=>{setDetails(false);setCloseout(false);setSwitching(true);}}>Switch truck</button><button className={styles.secondary} disabled={busy || jobLoading || Boolean(pendingCloseout)} onClick={()=>{setDetails(false);setEditingCrew(true);setCloseout(false);}}>Edit crew</button><button className={styles.secondary} disabled={busy || jobLoading || Boolean(pendingCloseout)} onClick={()=>void disconnect()}>Disconnect company phone</button><button className={styles.secondary} disabled={busy || jobLoading || details} onClick={()=>void refresh()}>Check connection</button>{phone.test && <button className={styles.secondary} disabled={busy || jobLoading} onClick={async()=>{setBusy(true);try{const response=await fetch('/api/crew-jobs/day',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reset-test-assignments'})});const body=await response.json();if(!response.ok)throw new Error(body.error || 'Reset failed.');await loadJob();}catch(e){setError(e instanceof Error?e.message:'Reset failed.');}finally{setBusy(false);}}}>Reset three test assignments</button>}</details>}
    </> : <><h1>Choose your phone</h1><RequestSetupCode busy={busy} onBusy={setBusy}/><p>Enter the 6-digit code from OpsBot to connect this phone for today.</p>
      <form className={styles.form} onSubmit={enroll}><label>Setup code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" spellCheck={false} value={code} maxLength={6} onChange={event => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))} required disabled={busy}/></label>
      <button className={styles.primary} disabled={busy || !/^[0-9]{6}$/.test(code.trim())}>{busy ? 'Connecting…' : 'Connect phone'}</button></form>
    </>}
    {phone && !day && <button className={styles.secondary} disabled={busy || jobLoading || Boolean(pendingCloseout)} onClick={()=>void disconnect()}>Disconnect company phone</button>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!loading && !phone && <button className={styles.secondary} onClick={() => void refresh()} disabled={busy || jobLoading}>Check connection</button>}
  </div></main>;
}
