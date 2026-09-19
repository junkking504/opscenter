'use client';
import { useEffect, useRef, useState } from 'react';
import { CREW_PHONE_API, type CrewPhone, type CrewPhoneDay } from '@/lib/crew-phone';
import type { CrewCurrent } from '@/lib/crew-dispatch';
import styles from './phone-access.module.css';
import JobCloseout from './job-closeout';
import DailyCrew from './daily-crew';
import {chicagoDateKey} from '@/lib/chicago-date';
import { clearCrewCloseoutDrafts, crewCloseoutKey } from '../../desktop-ui/lib/closeout-drafts';
import JobPhotos, { clearCrewPhotoDrafts } from './job-photos';

const pendingKey = 'ops-crew-phone-enrollment-v1';
type Pending = { code: string; connectionKey: string };
export default function CrewPhoneSetup() {
  const [phone, setPhone] = useState<CrewPhone | null>(null);
  const [day,setDay]=useState<CrewPhoneDay|null>(null),[dayDate,setDayDate]=useState(''),[roster,setRoster]=useState<string[]>([]),[editingCrew,setEditingCrew]=useState(false);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const [assignment,setAssignment]=useState<CrewCurrent|null>(null);
  const [jobLoading,setJobLoading]=useState(false);
  const [details,setDetails]=useState(false);
  const [closeout,setCloseout]=useState(false);
  const jobRequest=useRef(0);
  async function loadJob() {
    const request=++jobRequest.current;
    setJobLoading(true);setAssignment(null);setError('');
    try {
      const dayResponse=await fetch('/api/crew-jobs/day',{cache:'no-store'}),dayBody=await dayResponse.json();
      if(request!==jobRequest.current)return;
      if(dayResponse.status===401){setPhone(null);setDay(null);throw new Error(dayBody.error || 'This phone needs manager setup.');}
      if(!dayResponse.ok)throw new Error(dayBody.error || 'Today’s crew could not be loaded.');
      setDay(dayBody.day);setDayDate(dayBody.date);setRoster(dayBody.roster);setEditingCrew(false);
      if(!dayBody.day)return;
      const response=await fetch('/api/crew-jobs/current',{cache:'no-store'});
      const body=await response.json();
      if(request!==jobRequest.current)return;
      if(response.status===401){void clearCrewPhotoDrafts().catch(()=>{});setJobLoading(false);clearCrewCloseoutDrafts();setDay(null);setPhone(null);throw new Error(body.error || 'This phone needs manager setup.');}
      if(!response.ok)throw new Error(body.error || 'Your assignment could not be verified. Contact dispatch.');
      setAssignment(body);setDetails(false);setCloseout(false);
      clearCrewCloseoutDrafts(body.job && phone?crewCloseoutKey(phone.deviceId,body.job.assignmentId):undefined);
    }catch(error){if(request===jobRequest.current)setError(error instanceof Error?error.message:'Your assignment could not be verified. Contact dispatch.');}
    finally{if(request===jobRequest.current)setJobLoading(false);}
  }
  useEffect(()=>{
    if(phone)void loadJob();
    return ()=>{jobRequest.current++;};
  },[phone?.deviceId]);
  useEffect(()=>{const resume=()=>{if(document.visibilityState==='visible' && phone && dayDate && dayDate!==chicagoDateKey() && !busy)void loadJob();};document.addEventListener('visibilitychange',resume);return()=>document.removeEventListener('visibilitychange',resume);});
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
  return <main className={styles.page}><div className={styles.content}>
    <header className={styles.header}><div className={styles.brand}>Kingpin<small>JUNK KING</small></div><span className={styles.badge}>{phone?.truck || 'Company phone'}</span></header>
    {loading ? <p role="status">Checking this phone…</p> : phone ? <>
      {jobLoading ? <p role="status">Checking today’s crew and current assignment…</p> : dayDate && (!day || editingCrew) ? <DailyCrew key={`${phone.deviceId}:${dayDate}:${day?.version || 0}`} date={dayDate} roster={roster} day={day} onBusy={setBusy} onSaved={()=>void loadJob()} onCancel={()=>setEditingCrew(false)}/> : assignment?.state==='waiting' ? <><h1>Waiting for assignment</h1><p>Dispatch will send your next job here.</p></> : assignment?.state==='assigned' && assignment.job ? <>
        <h1>{details?'Job details':'Current job'}</h1>
        <section className={styles.card}><p className={styles.muted}>{assignment.job.jkNumber} · {assignment.job.appointmentTime}</p><h2>{assignment.job.customerName}</h2><p>{assignment.job.address}</p>
          {details && closeout ? <JobCloseout key={assignment.job.assignmentId} job={assignment.job} truck={phone.truck} deviceId={phone.deviceId} onBusyChange={setBusy} onBack={()=>setCloseout(false)} onNext={()=>void loadJob()}/> : details ? <><h2>Items to remove</h2><p>{assignment.job.junkItems.join(', ') || 'See job notes.'}</p><h2>Job notes</h2>{assignment.job.appointmentNotes.length?assignment.job.appointmentNotes.map((note,index)=><p key={index}>{note}</p>):<p>No job notes.</p>}<h2>Assigned crew</h2><p>{day?.driver || assignment.job.driver} · Driver</p><p>{day?.navigators.join(', ') || 'No navigator'} · Navigator</p>
          <JobPhotos key={assignment.job.assignmentId} deviceId={phone.deviceId} assignmentId={assignment.job.assignmentId} onBusyChange={setBusy}/><button className={styles.primary} disabled={busy} onClick={()=>setCloseout(true)}>Close out job</button><button className={styles.secondary} disabled={busy} onClick={()=>setDetails(false)}>Back to current job</button></> : <><p>{assignment.job.junkItems.join(' · ')}</p><button className={styles.primary} onClick={()=>setDetails(true)}>View job</button></>}
        </section><p className={styles.muted}>Upload job photos and close this appointment before receiving your next assignment.</p>
      </> : <><h1>Assignment unavailable</h1><p>{assignment?.message || 'Your assignment could not be verified. Contact dispatch.'}</p></>}
      {day && !editingCrew && <section className={styles.card}><h2>Today’s crew</h2><p>{day.driver} · Driver<br/>{day.navigators.join(', ') || 'No navigator'} · Navigator</p><p>Responsible for phone: {day.responsible}</p><button className={styles.secondary} disabled={busy || jobLoading} onClick={()=>{setEditingCrew(true);setCloseout(false);}}>Change today’s crew</button></section>}
      <button className={styles.primary} onClick={()=>void loadJob()} disabled={jobLoading || busy}>{day?'Refresh assignment':'Refresh crew setup'}</button>
    </> : <><h1>Company phone setup</h1><p>Your manager generates the setup code in OpsCenter. Enter the 6-digit code sent by OpsBot on WhatsApp, or given to you by your manager.</p>
      <form className={styles.form} onSubmit={enroll}><label>Setup code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" spellCheck={false} value={code} maxLength={6} onChange={event => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))} required disabled={busy}/></label>
      <button className={styles.primary} disabled={busy || !/^[0-9]{6}$/.test(code.trim())}>{busy ? 'Connecting…' : 'Connect phone'}</button></form>
    </>}
    {phone && <button className={styles.secondary} disabled={busy || jobLoading} onClick={()=>void disconnect()}>Disconnect company phone</button>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!loading && <button className={styles.secondary} onClick={() => void refresh()} disabled={busy || jobLoading}>Check connection</button>}
  </div></main>;
}
