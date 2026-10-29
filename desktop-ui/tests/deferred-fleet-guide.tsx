import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConvoyGuide } from '../convoy-guide';
import type { FleetView } from '../lib/people-fleet-contract';
import '../app/globals.css';
import '../fleet-base.css';
import '../approved-workbench.css';
import '../theme.css';
function Fixture() {
  const [view, setView] = useState<FleetView>('overview');
  return <main className="ops-app ops-live" style={{display:'block'}}><output aria-label="Selected view">{view}</output><ConvoyGuide view={view} date="2026-10-26" onView={setView}/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
