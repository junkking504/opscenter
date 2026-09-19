'use client';

import { useState } from 'react';
import CrewPhoneApp from '@/app/crew-jobs/crew-phone-app';
import styles from './waypoint-app.module.css';
import { CREW_JOBS_ORIGIN } from '@/lib/crew-phone';
import TruckInspectionApp from './TruckInspectionApp';

type Step = 'setup' | 'inspection' | 'jobs';

export default function WaypointApp({ jobsHref }: { initialView?: 'jobs' | 'inspections'; jobsHref?: string }) {
  const [step, setStep] = useState<Step>('setup');
  return <div className={styles.app}>
    <header className={styles.header}>
      <div className={styles.brand}>
        <img src={jobsHref ? `${CREW_JOBS_ORIGIN}/crew-jobs/waypoint-compass-crown-v2-192.png` : '/crew-jobs/waypoint-compass-crown-v2-192.png'} width="52" height="52" alt="" />
        <div><strong>Waypoint</strong><span>JUNK KING</span></div>
      </div>
      {jobsHref ? <a className={styles.legacyEntry} href={jobsHref}>Open Waypoint daily setup →</a> : <ol className={styles.steps} aria-label="Start your day">
        <li aria-current={step === 'setup' ? 'step' : undefined}><span>1</span>Truck setup</li>
        <li aria-current={step === 'inspection' ? 'step' : undefined}><span>2</span>Inspection</li>
        <li aria-current={step === 'jobs' ? 'step' : undefined}><span>3</span>Jobs</li>
      </ol>}
    </header>
    <div>{jobsHref ? <TruckInspectionApp /> : <CrewPhoneApp onStepChange={setStep} />}</div>
  </div>;
}
