'use client';

import { useEffect, useState } from 'react';
import ManagerApp from '@/app/crew-jobs/manager-app';
import CrewPhoneApp from '@/app/crew-jobs/crew-phone-app';
import styles from './waypoint-app.module.css';
import { CREW_JOBS_ORIGIN } from '@/lib/crew-phone';
import TruckInspectionApp from './TruckInspectionApp';

type Step = 'setup' | 'inspection' | 'jobs';

export default function WaypointApp({ jobsHref }: { initialView?: 'jobs' | 'inspections'; jobsHref?: string }) {
  const [manager,setManager]=useState(false),[managerView,setManagerView]=useState(false);
  useEffect(()=>{if(jobsHref)return;let active=true;void fetch('/api/crew-jobs/session',{cache:'no-store'}).then(r=>r.json()).then(body=>{if(active){setManager(body.manager===true);setManagerView(body.manager===true);}}).catch(()=>{});return()=>{active=false;};},[jobsHref]);
  const [step, setStep] = useState<Step>('setup');
  const [test,setTest]=useState(false);
  return <div className={styles.app}>
    <header className={styles.header}>
      <div className={styles.brand}>
        <img src={jobsHref ? `${CREW_JOBS_ORIGIN}/crew-jobs/waypoint-crown-road-v1-192.png` : '/crew-jobs/waypoint-crown-road-v1-192.png'} width="52" height="52" alt="" />
        <div><strong>Waypoint</strong><span>JUNK KING</span></div>
      </div>
      {jobsHref ? <a className={styles.legacyEntry} href={jobsHref}>Open Waypoint daily setup →</a> : !managerView && step !== 'jobs' ? <ol className={styles.steps} aria-label="Start your day">
        <li aria-current={step === 'setup' ? 'step' : undefined}><span>1</span>Truck setup</li>
        <li aria-current={step === 'inspection' ? 'step' : undefined}><span>2</span>Inspection</li>
        <li><span>3</span>Assignments</li>
      </ol> : null}
    </header>
    {manager&&<nav aria-label="Waypoint views" className={styles.managerViews}><button onClick={()=>setManagerView(true)} aria-pressed={managerView}>Manager</button><button onClick={()=>setManagerView(false)} aria-pressed={!managerView}>Crew workflow</button></nav>}
    <div>{test && <p role="status" style={{padding:"12px 20px",background:"#fff3cd",color:"#664d03",margin:0}}><strong>Test mode</strong> · Fictional assignments. Truck changes, inspections and payments stay in this test.</p>}{jobsHref ? <TruckInspectionApp /> : managerView&&manager?<ManagerApp onCrew={()=>setManagerView(false)}/>:<CrewPhoneApp onStepChange={setStep} onTestChange={setTest} onManagerChange={setManager} />}</div>
  </div>;
}
