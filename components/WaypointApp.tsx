'use client';

import { useState } from 'react';
import CrewPhoneApp from '@/app/crew-jobs/crew-phone-app';
import TruckInspectionApp from './TruckInspectionApp';
import styles from './waypoint-app.module.css';
import { CREW_JOBS_ORIGIN } from '@/lib/crew-phone';

type View = 'jobs' | 'inspections';

export default function WaypointApp({ initialView, jobsHref }: { initialView: View; jobsHref?: string }) {
  const [view, setView] = useState<View>(initialView);
  const [visited, setVisited] = useState({ jobs: initialView === 'jobs', inspections: initialView === 'inspections' });
  const [jobsBusy, setJobsBusy] = useState(false);
  const [inspectionBusy, setInspectionBusy] = useState(false);
  const busy = jobsBusy || inspectionBusy;

  function select(next: View) {
    if (busy) return;
    setVisited(previous => ({ ...previous, [next]: true }));
    setView(next);
  }

  return <div className={styles.app}>
    <header className={styles.header}>
      <div className={styles.brand}>
        <img src={jobsHref ? `${CREW_JOBS_ORIGIN}/crew-jobs/waypoint-compass-crown-v2-192.png` : "/crew-jobs/waypoint-compass-crown-v2-192.png"} width="52" height="52" alt="" />
        <div><strong>Waypoint</strong><span>JUNK KING</span></div>
      </div>
      <nav className={styles.navigation} aria-label="Waypoint">
        {jobsHref ? <a href={jobsHref} target="_blank" rel="noopener noreferrer">Jobs ↗</a> : <button type="button" aria-current={view === 'jobs' ? 'page' : undefined} aria-controls="waypoint-jobs" disabled={busy} onClick={() => select('jobs')}>Jobs</button>}
        <button type="button" aria-current={view === 'inspections' ? 'page' : undefined} aria-controls="waypoint-inspections" disabled={busy} onClick={() => select('inspections')}>Inspections</button>
      </nav>
    </header>
    {/* Keep visited workflows mounted: switching never discards a draft or receipt. */}
    <div id="waypoint-jobs" hidden={view !== 'jobs'}>{visited.jobs && <CrewPhoneApp onBusyChange={setJobsBusy} />}</div>
    <div id="waypoint-inspections" hidden={view !== 'inspections'}>{visited.inspections && <TruckInspectionApp onBusyChange={setInspectionBusy} />}</div>
  </div>;
}
