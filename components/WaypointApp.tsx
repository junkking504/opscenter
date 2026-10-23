'use client';

import { useEffect, useState } from 'react';
import ManagerApp from '@/app/crew-jobs/manager-app';
import CrewPhoneApp from '@/app/crew-jobs/crew-phone-app';
import styles from './waypoint-app.module.css';
import { CREW_JOBS_ORIGIN } from '@/lib/crew-phone';
import TruckInspectionApp from './TruckInspectionApp';

type Step = 'connect' | 'setup' | 'inspection' | 'jobs';

export default function WaypointApp({ jobsHref }: { initialView?: 'jobs' | 'inspections'; jobsHref?: string }) {
  const [manager,setManager]=useState(false),[managerView,setManagerView]=useState(true);
  const [accountManager,setAccountManager]=useState(false);
  const [sessionState,setSessionState]=useState<'loading'|'ready'|'error'>('loading');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(jobsHref)return;
    let active=true;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),10_000);
    setSessionState('loading');
    async function check(path:string,phone=false):Promise<boolean|null>{
      try{
        const response=await fetch(path,{cache:'no-store',signal:controller.signal});
        if(phone&&(response.status===401||response.status===403))return false;
        if(!response.ok)return null;
        const body=await response.json();
        return typeof body.manager==='boolean'?body.manager:null;
      }catch{return null;}
    }
    void Promise.all([check('/api/crew-jobs/session',true),check('/api/crew-jobs/manager-session')]).then(([phone,account])=>{
      clearTimeout(timer);
      if(!active)return;
      setManager(phone===true);setAccountManager(account===true);
      setSessionState(phone===true||account===true||(phone!==null&&account!==null)?'ready':'error');
    });
    return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[jobsHref,attempt]);
  const showManager=managerView&&(manager||accountManager);
  const [step, setStep] = useState<Step>('connect');
  const [test,setTest]=useState(false);
  return <div className={styles.app}>
    <header className={`${styles.header} ${!jobsHref && !showManager && step === 'connect' ? styles.connectionHeader : !jobsHref && (showManager || step==='jobs') ? styles.routeHeader : ''}`}>
      <div className={styles.brand}>
        <img src={jobsHref ? `${CREW_JOBS_ORIGIN}/crew-jobs/waypoint-crown-road-v1-192.png` : '/crew-jobs/waypoint-crown-road-v1-192.png'} width="52" height="52" alt="" />
        <div><strong>Waypoint</strong><span>JUNK KING</span></div>
      </div>
      {jobsHref ? <a className={styles.legacyEntry} href={jobsHref}>Open Waypoint daily setup →</a> : !showManager && step !== 'jobs' && step !== 'connect' ? <ol className={styles.steps} aria-label="Start your day">
        <li aria-current={step === 'setup' ? 'step' : undefined}><span>1</span>Truck setup</li>
        <li aria-current={step === 'inspection' ? 'step' : undefined}><span>2</span>Inspection</li>
        <li><span>3</span>Assignments</li>
      </ol> : null}
    </header>
    {(manager||accountManager)&&<nav aria-label="Waypoint views" className={styles.managerViews}><button onClick={()=>setManagerView(true)} aria-pressed={managerView}>Manager</button><button onClick={()=>setManagerView(false)} aria-pressed={!managerView}>Crew workflow</button></nav>}
    {!jobsHref&&sessionState==='ready'&&!manager&&!accountManager&&step==='connect'&&<nav className={styles.managerViews}><a href="/login?next=/crew-jobs">Manager sign-in</a></nav>}
    {accountManager&&<nav className={styles.managerViews}><a href="/api/auth/logout">Sign out of manager account</a></nav>}
    <div>{test && <p role="status" style={{padding:"12px 20px",background:"#fff3cd",color:"#664d03",margin:0}}><strong>Test mode</strong> · Fictional assignments. Truck changes, inspections and payments stay in this test.</p>}{jobsHref ? <TruckInspectionApp /> : sessionState==='loading'?<p className={styles.sessionNotice} role="status">Checking Waypoint access…</p>:sessionState==='error'?<section className={styles.sessionNotice} role="alert"><p>Waypoint access could not be checked. Retry to open your portal.</p><button onClick={()=>setAttempt(value=>value+1)}>Retry access check</button></section>:showManager?<ManagerApp onCrew={()=>setManagerView(false)}/>:<CrewPhoneApp onStepChange={setStep} onTestChange={setTest} onManagerChange={setManager} />}</div>
  </div>;
}
