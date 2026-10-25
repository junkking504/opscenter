'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ManagerApp from '@/app/crew-jobs/manager-app';
import CrewPhoneApp, {type CrewViewContext} from '@/app/crew-jobs/crew-phone-app';
import type {ManagerContext} from '@/app/crew-jobs/manager-presentation';
import type {LeaveGuard} from '@/app/crew-jobs/manager-navigation';
import styles from './waypoint-app.module.css';
import { CREW_JOBS_ORIGIN } from '@/lib/crew-phone';
import {WAYPOINT_UPDATES_PATH} from '@/lib/waypoint-entry';
import TruckInspectionApp from './TruckInspectionApp';

type Step = 'connect' | 'setup' | 'inspection' | 'jobs';

export default function WaypointApp({ jobsHref }: { initialView?: 'jobs' | 'inspections'; jobsHref?: string }) {
  const [manager,setManager]=useState(false),[managerView,setManagerView]=useState(false);
  const [accountManager,setAccountManager]=useState(false);
  const [sessionState,setSessionState]=useState<'loading'|'ready'|'error'>('loading'),[attempt,setAttempt]=useState(0);
  const [updatesEntry,setUpdatesEntry]=useState(false);
  const managerContext=useRef<ManagerContext>({}),crewContext=useRef<CrewViewContext>({});
  const saveManagerContext=useCallback((value:Partial<ManagerContext>)=>{managerContext.current={...managerContext.current,...value};},[]);
  const saveCrewContext=useCallback((value:Partial<CrewViewContext>)=>{crewContext.current={...crewContext.current,...value};},[]);
  const guards=useRef<{manager:LeaveGuard|null;crew:LeaveGuard|null}>({manager:null,crew:null});
  const managerGuard=useCallback((guard:LeaveGuard|null)=>{guards.current.manager=guard;},[]);
  const crewGuard=useCallback((guard:LeaveGuard|null)=>{guards.current.crew=guard;},[]);
  const canSwitch=()=>!guards.current[managerView?'manager':'crew'] || guards.current[managerView?'manager':'crew']!();
  const switchView=(next:boolean)=>{if(next!==managerView&&canSwitch()){setManagerView(next);window.scrollTo({top:0});}};

  useEffect(()=>{
    if(jobsHref)return;
    let active=true;
    const updates=new URLSearchParams(window.location.search).get('view')==='updates';
    setUpdatesEntry(updates);if(updates)crewContext.current={...crewContext.current,view:'notifications'};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10_000);
    setSessionState('loading');
    async function check(path:string,phone=false):Promise<boolean|null>{
      try{const response=await fetch(path,{cache:'no-store',signal:controller.signal});
        if(phone&&response.status===401)return false;
        if(!response.ok)return null;
        const body=await response.json();return typeof body.manager==='boolean'?body.manager:null;
      }catch{return null;}
    }
    void Promise.all([check('/api/crew-jobs/session',true),check('/api/crew-jobs/manager-session')]).then(([phone,account])=>{
      clearTimeout(timer);if(!active)return;
      setManager(phone===true);setAccountManager(account===true);setManagerView(!updates&&(phone===true||account===true));
      setSessionState(phone===true||account===true||(phone!==null&&account!==null)?'ready':'error');
    });
    return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[jobsHref,attempt]);
  const [step, setStep] = useState<Step>('connect');
  const [test,setTest]=useState(false);
  return <div className={styles.app}>
    <header className={`${styles.header} ${!jobsHref && !managerView && step === 'connect' ? styles.connectionHeader : !jobsHref && (managerView || step==='jobs') ? styles.routeHeader : ''}`}>
      <div className={styles.brand}>
        <img src={jobsHref ? `${CREW_JOBS_ORIGIN}/crew-jobs/waypoint-crown-road-v1-192.png` : '/crew-jobs/waypoint-crown-road-v1-192.png'} width="52" height="52" alt="" />
        <div><strong>Waypoint</strong><span>JUNK KING</span></div>
      </div>
      {jobsHref ? <a className={styles.legacyEntry} href={jobsHref}>Open Waypoint daily setup →</a> : !managerView && step !== 'jobs' && step !== 'connect' ? <ol className={styles.steps} aria-label="Start your day">
        <li aria-current={step === 'setup' ? 'step' : undefined}><span>1</span>Truck setup</li>
        <li aria-current={step === 'inspection' ? 'step' : undefined}><span>2</span>Inspection</li>
        <li><span>3</span>Assignments</li>
      </ol> : null}
    </header>
    {(manager||accountManager)&&<nav aria-label="Waypoint views" className={styles.managerViews}><button onClick={()=>switchView(true)} aria-pressed={managerView}>Manager</button><button onClick={()=>switchView(false)} aria-pressed={!managerView}>Crew workflow</button></nav>}
    {!jobsHref&&sessionState==='ready'&&!manager&&!accountManager&&step==='connect'&&<nav className={styles.managerViews}><a href={`/login?next=${encodeURIComponent(updatesEntry?WAYPOINT_UPDATES_PATH:'/crew-jobs')}`}>Manager sign-in</a></nav>}
    {accountManager&&<nav className={styles.managerViews}><a href="/api/auth/logout" onClick={event=>{if(!canSwitch())event.preventDefault();}}>Sign out of manager account</a></nav>}
    <div>{test && <p role="status" style={{padding:"12px 20px",background:"#fff3cd",color:"#664d03",margin:0}}><strong>Test mode</strong> · Fictional assignments. Truck changes, inspections and payments stay in this test.</p>}{jobsHref ? <TruckInspectionApp /> : sessionState==='loading'?<p className={styles.sessionNotice} role="status">Checking Waypoint access…</p>:sessionState==='error'?<section className={styles.sessionNotice} role="alert"><p>Waypoint access could not be checked. Retry to open your portal.</p><button onClick={()=>setAttempt(value=>value+1)}>Retry access check</button></section>:managerView&&(manager||accountManager)?<ManagerApp context={managerContext.current} onContextChange={saveManagerContext} onGuard={managerGuard} onCrew={()=>{setManagerView(false);window.scrollTo({top:0});}}/>:<CrewPhoneApp context={crewContext.current} onContextChange={saveCrewContext} onGuard={crewGuard} onStepChange={setStep} onTestChange={setTest} onManagerChange={setManager} />}</div>
  </div>;
}
