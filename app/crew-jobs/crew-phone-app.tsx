'use client';
import {checkedCrewReceipt} from './closeout-receipt';
import CustomerEdit from './customer-edit';
import WaypointNotifications from './notifications';
import RouteOverview,{RouteIcon} from './route-overview';
import {waypointStops} from '@/lib/waypoint-route';
import type {NotificationConnection} from './notifications';
import { truckDisplayText, sameTruck } from '../../lib/junkware-trucks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CREW_PHONE_API, type CrewPhone, type CrewPhoneDay } from '@/lib/crew-phone';
import type { CrewCurrent, CrewScheduledJob } from '@/lib/crew-dispatch';
import styles from './phone-access.module.css';
import navigation from './navigation.module.css';
import {createWaypointViewGuard} from './view-guard';
import JobCloseout from './job-closeout';
import AppointmentSignatureSection from './appointment-signature';
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
const dayViews=[{id:'route',label:'Route',icon:'pin'},{id:'completed',label:'Completed',icon:'completed'},{id:'performance',label:'Performance',icon:'performance'},{id:'notifications',label:'Notifications',icon:'bell'},{id:'messages',label:'Messages',icon:'message'}] as const;
import type {LeaveGuard} from './manager-navigation';
export type CrewViewContext={view?:'route'|'completed'|'performance'|'notifications'|'messages';truck?:string;phoneTruck?:string;scroll?:number};
type Pending = { code: string; connectionKey: string };
export default function CrewPhoneSetup({ onBusyChange, onStepChange, onTestChange, onManagerChange, onGuard, context, onContextChange }: { context?:CrewViewContext;onContextChange?:(context:Partial<CrewViewContext>)=>void;onGuard?:(guard:LeaveGuard|null)=>void; onManagerChange?: (manager:boolean)=>void; onTestChange?: (test:boolean)=>void; onBusyChange?: (busy: boolean) => void; onStepChange?: (step: 'connect' | 'setup' | 'inspection' | 'jobs') => void }) {
  const [view,setView]=useState<'route'|'completed'|'performance'|'notifications'|'messages'>(context?.view || 'route');
  const [notificationConnection,setNotificationConnection]=useState<NotificationConnection>('checking');
  const [viewTruck,setViewTruck]=useState(context?.truck || '');
  useEffect(()=>{onContextChange?.({view,truck:viewTruck});},[onContextChange,view,viewTruck]);
  const [editingCustomer,setEditingCustomer]=useState(false);
  const [viewGuard]=useState(createWaypointViewGuard);
  const [phone, setPhone] = useState<CrewPhone | null>(null);
  const priorPhoneTruck=useRef(context?.phoneTruck);
  const currentPhoneTruck=phone?.truck;
  useEffect(()=>{if(!currentPhoneTruck)return;if(priorPhoneTruck.current&&priorPhoneTruck.current!==currentPhoneTruck)setViewTruck('');priorPhoneTruck.current=currentPhoneTruck;onContextChange?.({phoneTruck:currentPhoneTruck});},[currentPhoneTruck,onContextChange]);
  const [day,setDay]=useState<CrewPhoneDay|null>(null),[dayDate,setDayDate]=useState(''),[roster,setRoster]=useState<string[]>([]),[editingCrew,setEditingCrewState]=useState(false);
  const [trucks,setTrucks]=useState<string[]>([]),[inspectionRequired,setInspectionRequired]=useState(true);
  const [switching,setSwitchingState]=useState(false),[truckSwitch,setTruckSwitch]=useState<SwitchSummary|null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [sessionUnavailable,setSessionUnavailable]=useState(false);
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
  const step=!phone ? 'connect' : !day || editingCrew || switching ? 'setup' : inspectionRequired ? 'inspection' : 'jobs';
  useEffect(()=>{onStepChange?.(step);},[step,onStepChange]);
  useEffect(()=>{onGuard?.(()=>{
    if(viewGuard.blocked()||editingCustomer||pendingCloseout||handoff&&['transferring','submitting'].includes(handoff.phase)||phone&&step!=='jobs') {setError('Finish or return from the current crew form and check any pending checkout before switching views.');return false;}
    onContextChange?.({scroll:window.scrollY});return true;
  });return()=>onGuard?.(null);},[onGuard,onContextChange,viewGuard,editingCustomer,pendingCloseout,handoff,phone,step]);
  const restoredScroll=useRef(false);
  useEffect(()=>{if(step==='jobs'&&!jobLoading&&!restoredScroll.current){const frame=requestAnimationFrame(()=>{restoredScroll.current=true;window.scrollTo({top:context?.scroll || 0});});return()=>cancelAnimationFrame(frame);}},[step,jobLoading,context]);

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
      if(value.receipt){try{const receipt=checkedCrewReceipt(value.receipt,value.requestId);value={...value,receipt,...(receipt!==value.receipt?{phase:'attention' as const,message:receipt.message}:{})};}catch{showBackgroundNotice('Saved checkout identity needs review. Do not submit again.',value.assignmentId);return;}}
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
    // Accepted receipts return to Assignments immediately. Reconcile with GET
    // only; reopening recovery pauses this reader and never creates a new POST.
    if(!pendingCloseout?.requestId || details && closeout)return;
    const pending=pendingCloseout as {assignmentId:string;requestId:string};
    let canceled=false,timer:ReturnType<typeof setTimeout>|undefined;
    const check=async()=>{
      try{
        const response=await fetch(`/api/crew-jobs/closeout?assignmentId=${encodeURIComponent(pending.assignmentId)}&requestId=${encodeURIComponent(pending.requestId)}`,{cache:'no-store',signal:AbortSignal.timeout(15_000)});
        const body=await response.json();
        if(canceled)return;
        if(!response.ok || !body.receipt)throw new Error(body.error || 'Background checkout status is unavailable.');
        const receipt=checkedCrewReceipt(body.receipt as Receipt,pending.requestId);
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
  },[pendingCloseout?.assignmentId,pendingCloseout?.requestId,details,closeout]);
  async function refresh() {
    if(viewGuard.blocked()){viewGuard.defer();return;}
    const request=++jobRequest.current,viewVersion=viewGuard.version();setLoading(true);setError('');setSessionUnavailable(false);
    try {
      const response = await fetch(CREW_PHONE_API, { cache: 'no-store',signal:AbortSignal.timeout(10_000) });
      const body = await response.json();
      if(request!==jobRequest.current)return;
      if(!viewGuard.current(viewVersion)){viewGuard.defer();return;}
      if (response.status === 401) { setDay(null);setPhone(null);onManagerChange?.(false); return; }
      if (!response.ok || !body.phone) throw new Error(body.error || 'Phone access could not be verified.');
      setPhone(body.phone);onManagerChange?.(body.manager===true);
      // A same-device refresh also needs a new current-assignment read.
      if(phone?.deviceId===body.phone.deviceId)void loadJob();
      try { localStorage.removeItem(pendingKey); } catch { /* Connection is already verified. */ }
    } catch (error) { setSessionUnavailable(true);setError(error instanceof Error ? error.message : 'Phone access could not be verified.'); }
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
    let verifying=false;
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
      const alreadyConnected=response.status===409&&body.code==='already_connected';
      if (!response.ok && !alreadyConnected) throw new Error(body.error || 'Setup could not be confirmed. Retry with this same code.');
      // Read with the cookie before dropping the recovery key or claiming setup.
      verifying=true;
      const check = await fetch(CREW_PHONE_API, { cache: 'no-store',signal:AbortSignal.timeout(10_000) });
      const saved = await check.json();
      if (!check.ok || !saved.phone?.deviceId || !alreadyConnected && saved.phone.deviceId !== body.phone?.deviceId) {setSessionUnavailable(true);throw new Error('Phone access could not be checked. Check connection before trying setup again.');}
      setPhone(saved.phone);setSessionUnavailable(false);onManagerChange?.(saved.manager===true);
      localStorage.removeItem(pendingKey);
    } catch (error) { if(verifying)setSessionUnavailable(true);setError(error instanceof Error ? error.message : 'Setup could not be confirmed. Retry with this same code.'); }
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
  const stopJobs=viewedJob?waypointStops(jobs,viewedJob.truck ?? phone?.truck ?? '').map(stop=>stop.job):[];
  const stopIndex=viewedJob?stopJobs.findIndex(job=>job.appointmentId===viewedJob.appointmentId):-1;
  const prevStop=stopIndex>0?stopJobs[stopIndex-1]:undefined,nextStop=stopIndex>=0?stopJobs[stopIndex+1]:undefined;
  const goStop=(id:string)=>{setSelectedAppointment(id);setCloseout(false);window.scrollTo({top:0});};
  if (!loading && phone && day && switching) return <main className={styles.page}><div className={styles.content}><SwitchTruck day={day} trucks={trucks} pending={truckSwitch} onBusy={setBusy} onDone={()=>{setSwitching(false);void loadJob();}} onCancel={()=>setSwitching(false)}/></div></main>;
  if (!loading && phone && day && !editingCrew && inspectionRequired) return <>
    <TruckInspectionApp key={`${phone.deviceId}:${day.date}:${day.version}`} apiPath="/api/crew-jobs/inspection" onBusyChange={setBusy} onContinue={()=>loadJob()}/>
    <div className={styles.workflowActions}><button className={styles.secondary} disabled={busy || jobLoading || Boolean(pendingCloseout)} onClick={()=>{setDetails(false);setCloseout(false);setSwitching(true);}}>Switch Truck</button><button className={styles.secondary} disabled={busy || jobLoading || Boolean(pendingCloseout)} onClick={()=>setEditingCrew(true)}>Edit Crew</button><button className={styles.secondary} disabled={busy || jobLoading} onClick={()=>void loadJob()}>Check inspection status</button>{error && <p role="alert">{error}</p>}</div>
  </>;
  return <main className={`${styles.page} ${!phone ? styles.connectionPage : styles.connectedPage} ${step==='jobs' && !details ? navigation.withNavigation : ''}`}><div className={styles.content}>
    {phone && step!=='jobs' && <p><span className={styles.badge}>{truckDisplayText(day?.truck || 'Company phone')}</span></p>}
    {loading ? <p role="status">Checking this phone…</p> : !phone && sessionUnavailable ? <section role="alert"><p>Phone access could not be checked. Retry before connecting a phone.</p><button className={styles.secondary} onClick={()=>void refresh()}>Check connection</button></section> : phone ? <>
      {backgroundNotice && <p className={pendingCloseout?styles.backgroundProgress:styles.backgroundNotice} role={pendingCloseout?'status':'alert'}>{backgroundNotice}</p>}
      {handoff && ['transferring','submitting'].includes(handoff.phase) && <button className={styles.secondary} onClick={()=>void resumeHandoff(handoff).catch(()=>showBackgroundNotice('Phone storage is unavailable. Keep this phone and ask the office to check the saved checkout.',handoff.assignmentId))}>Resume transfer</button>}
      {step==='jobs' && !details && <nav className={navigation.nav} aria-label="Your day">
        {dayViews.filter(item=>!phone.test || !['notifications','messages'].includes(item.id)).map(item=><button key={item.id} type="button" aria-current={view===item.id?'page':undefined} onClick={()=>{setView(item.id);window.scrollTo({top:0});}}><RouteIcon name={item.icon}/><span>{item.label}</span></button>)}
      </nav>}
      <div hidden={step==='jobs' && !details && view!=='route' && view!=='completed'}>
      {jobLoading ? <p role="status">Loading today’s assignments…</p> : dayDate && (!day || editingCrew) ? <DailyCrew key={`${phone.deviceId}:${dayDate}:${day?.version || 0}`} date={dayDate} roster={roster} trucks={trucks} day={day} onBusy={setBusy} onSaved={()=>{setEditingCrew(false);void loadJob();}} onCancel={()=>setEditingCrew(false)}/> : phone.test && view==='completed' && !assignment?.jobs ? <><h1>Completed Appointments</h1><p>Completed test appointment details are unavailable. See Performance for test totals.</p></> : phone.test && assignment?.state==='waiting' ? <><h1>Today’s Route</h1><p>{assignment.message || 'All three test assignments are complete.'}</p><p>You can reset test assignments in Truck &amp; Phone.</p></> : (assignment?.state==='assigned' || assignment?.state==='waiting') ? <>
        {details && <h1>Appointment Details</h1>}
        {!details || !viewedJob ? <RouteOverview chosenTruck={viewTruck} onTruckChange={setViewTruck} view={view==='completed'?'completed':'route'} jobs={jobs} truck={phone.truck} date={day?.date || dayDate} allTrucks={assignment.visibility==='all-trucks'} pendingId={pendingCloseout?.assignmentId} onSelect={id=>{setSelectedAppointment(id);setDetails(true);setCloseout(false);window.scrollTo({top:0});}}/> : <section className={`${styles.card} ${closeout ? styles.closeoutCard : ''}`}><p className={styles.muted}>{viewedJob.jkNumber} · {viewedJob.appointmentTime}</p><h2>{viewedJob.customerName}</h2>{assignment?.visibility==='all-trucks' && <p className={styles.muted}>{viewedJob.truck?truckDisplayText(viewedJob.truck):'Unassigned'}{viewedJob.readOnly?' · View only':''}</p>}<p><CustomerPhoneLink phone={viewedJob.phone}/></p><AssignmentOutcome job={viewedJob} details/><p><AddressLink address={viewedJob.address}/></p>
          {editingCustomer && viewedJob.assignmentId ? <CustomerEdit key={viewedJob.assignmentId} assignmentId={viewedJob.assignmentId} deviceId={phone.deviceId} onBusy={setBusy} onClose={saved=>{setEditingCustomer(false);if(saved){
              // Apply only the verified source read-back to the active card.
              // Normal schedule refresh resumes when the detail view closes.
              const address=[saved.fields.serviceAddress,[saved.city,[saved.state,saved.fields.serviceZip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
              const update=<T extends NonNullable<CrewCurrent['job']>|CrewScheduledJob,>(job:T):T=>job.assignmentId===viewedJob.assignmentId?{...job,customerName:[saved.fields.firstName,saved.fields.lastName].join(' '),phone:saved.fields.phone,address,mapLocation:address===job.address?job.mapLocation:null}:job;
              setAssignment(previous=>previous?{...previous,jobs:previous.jobs?.map(update),job:previous.job?update(previous.job):previous.job}:previous);
              showBackgroundNotice('Customer information saved and verified in JunkWare.',viewedJob.assignmentId!);void loadJob();
            }}}/> : closeout && !viewedJob.readOnly && viewedJob.assignmentId ? <JobCloseout key={viewedJob.assignmentId} job={{...viewedJob,assignmentId:viewedJob.assignmentId}} truck={phone.truck} deviceId={phone.deviceId} test={phone.test} onBusyChange={setBusy} onBack={()=>setCloseout(false)} onNext={()=>{setDetails(false);setCloseout(false);void loadJob();}} onAccepted={(receipt,receiptAssignmentId)=>{
            setPendingCloseout(receipt.status==='pending'?{assignmentId:receiptAssignmentId,requestId:receipt.requestId}:null);
            showBackgroundNotice(receipt.status==='verified'?'Checkout finished and was verified in JunkWare.':'Checkout accepted by the server. JunkWare verification is still pending.',viewedJob.assignmentId!);
            if(viewGuard.selected()===viewedJob.appointmentId){setView('route');setDetails(false);setCloseout(false);}
            void loadJob();
          }} onHandoffFailed={message=>{setPendingCloseout(null);showBackgroundNotice(message,viewedJob.assignmentId!);}}/> : <><h2>Items To Remove</h2><p>{viewedJob.junkItems.join(', ') || 'See job notes.'}</p><h2>Job Notes</h2>{viewedJob.appointmentNotes.length?viewedJob.appointmentNotes.map((note,index)=><p key={index}>{note}</p>):<p>No job notes.</p>}<h2>Assigned Crew</h2><p>{viewedJob.driver || (viewedJob.readOnly?'Not listed':day?.driver)} · Driver</p><p>{viewedJob.navigator || (!viewedJob.readOnly && day?.navigators.join(', ')) || 'No navigator'} · Navigator</p>
          <AppointmentSignatureSection key={`signature:${viewedJob.appointmentId}`} appointmentId={viewedJob.appointmentId} assignmentId={viewedJob.assignmentId} deviceId={phone.deviceId} readOnly={viewedJob.readOnly} test={phone.test} onBusyChange={setBusy}/>
          {!phone.test && !viewedJob.readOnly && sameTruck(viewedJob.truck,phone.truck) && viewedJob.assignmentId && /^confirmed$/i.test(viewedJob.status) && <button className={styles.secondary} disabled={busy || Boolean(pendingCloseout)} onClick={()=>setEditingCustomer(true)}>Edit Customer Information</button>}
          {!viewedJob.readOnly && viewedJob.assignmentId && !/^completed$/i.test(viewedJob.status) ? <button className={styles.primary} disabled={busy} onClick={()=>setCloseout(true)}>{pendingCloseout?.assignmentId===viewedJob.assignmentId?'Check Saved Checkout':'START'}</button> : <p className={styles.muted}>{viewedJob.readOnly?'View only · Closeout stays with the assigned truck.':/^completed$/i.test(viewedJob.status)?'Completed in JunkWare.':'Closeout is available when dispatch releases this appointment.'}</p>}<nav className={styles.stopBar} aria-label="Stops"><button className={styles.secondary} aria-label={prevStop?`Previous stop: ${prevStop.customerName}`:'No previous stop'} disabled={busy || !prevStop} onClick={()=>prevStop&&goStop(prevStop.appointmentId)}>‹</button><button className={styles.secondary} disabled={busy} onClick={()=>setDetails(false)}>All Assignments</button><button className={styles.secondary} aria-label={nextStop?`Next stop: ${nextStop.customerName}`:'No next stop'} disabled={busy || !nextStop} onClick={()=>nextStop&&goStop(nextStop.appointmentId)}>›</button></nav></>}
        </section>}
      </> : <><h1>Assignment Unavailable</h1><p>{assignment?.message || 'Your assignment could not be verified. Contact dispatch.'}</p></>}
      </div>
      {step==='jobs' && !details && view==='performance' && <section className={navigation.performance} aria-label="Performance"><h1>Today’s Performance</h1>{assignment?.summary?<DaySummary summary={assignment.summary}/>:<p>Today’s totals are unavailable. Refresh to check again.</p>}</section>}
      {day && !phone.test && <div hidden={details || step!=='jobs' || (view!=='notifications' && view!=='messages')}><WaypointNotifications onView={setView} jobs={jobs} onJob={id=>{setSelectedAppointment(id);setView('route');setDetails(true);setCloseout(false);window.scrollTo({top:0});}} onConnectionChange={setNotificationConnection} key={`${phone.deviceId}:${day.truck}`} view={view==='messages'?'messages':'notifications'}/></div>}
      {step==='jobs' && !details && view==='route' && !phone.test && <button className={`${navigation.connection} ${notificationConnection==='on'||notificationConnection==='checking'?'':navigation.connectionAlert}`} onClick={()=>{setView('notifications');window.scrollTo({top:0});}}><RouteIcon name="bell"/><span><strong>{notificationConnection==='on'?'Notifications on':notificationConnection==='checking'?'Checking notifications…':notificationConnection==='attention'?'Check Notifications':'Notifications Off'}</strong><small>{notificationConnection==='on'?'New jobs, changes and office messages.':'You may miss new jobs and office messages. Tap to turn them on.'}</small></span><RouteIcon name="chevron"/></button>}
      {(!details && (view==='route' || view==='completed' || view==='performance') || step!=='jobs') && <button className={`${styles.secondary} ${navigation.refresh}`} onClick={()=>void loadJob()} disabled={jobLoading || busy}>{day?'Refresh Assignments':'Refresh setup'}</button>}
      {day && !editingCrew && <details className={`${styles.card} ${navigation.phoneSettings}`}><summary>Truck &amp; Phone</summary><h2>{truckDisplayText(day.truck)} · Today’s crew</h2><p>{day.driver} · Driver<br/>{day.navigators.join(', ') || 'No navigator'} · Navigator</p><button className={styles.secondary} disabled={busy || jobLoading || Boolean(pendingCloseout)} onClick={()=>{setDetails(false);setCloseout(false);setSwitching(true);}}>Switch Truck</button><button className={styles.secondary} disabled={busy || jobLoading || Boolean(pendingCloseout)} onClick={()=>{setDetails(false);setEditingCrew(true);setCloseout(false);}}>Edit Crew</button><button className={styles.secondary} disabled={busy || jobLoading || Boolean(pendingCloseout)} onClick={()=>void disconnect()}>Disconnect Company Phone</button><button className={styles.secondary} disabled={busy || jobLoading || details} onClick={()=>void refresh()}>Check connection</button>{phone.test && <button className={styles.secondary} disabled={busy || jobLoading} onClick={async()=>{setBusy(true);try{const response=await fetch('/api/crew-jobs/day',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reset-test-assignments'})});const body=await response.json();if(!response.ok)throw new Error(body.error || 'Reset failed.');await loadJob();}catch(e){setError(e instanceof Error?e.message:'Reset failed.');}finally{setBusy(false);}}}>Reset three test assignments</button>}</details>}
    </> : <RequestSetupCode busy={busy} onBusy={setBusy} hasPendingCode={Boolean(code)} onChoosePhone={()=>{setCode('');setError('');}} connectionError={error} onCheckConnection={()=>void refresh()}>
      <form className={styles.form} onSubmit={enroll}><label>Verification code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" spellCheck={false} value={code} maxLength={6} onChange={event => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))} required disabled={busy}/></label>
      <button className={styles.primary} disabled={busy || !/^[0-9]{6}$/.test(code.trim())}>{busy ? 'Connecting…' : 'Connect phone'}</button></form>
    </RequestSetupCode>}
    {phone && !day && <button className={styles.secondary} disabled={busy || jobLoading || Boolean(pendingCloseout)} onClick={()=>void disconnect()}>Disconnect Company Phone</button>}
    {(phone || loading) && error && <p className={styles.error} role="alert">{error}</p>}
  </div></main>;
}
