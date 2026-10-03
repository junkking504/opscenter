import { fleetSnapshotUrl } from './lib/fleet-snapshot';
import { fetchWorkspace } from './lib/workspace-cache';
import { createRoot } from 'react-dom/client';
import Home from './app/page';
import LiveCommand from './live-command';
import { installMaintenanceTelemetry } from './lib/maintenance-telemetry';
import './app/globals.css';
import './live-responsive.css';
import './workspace-density.css';
import { WorkspaceBoundary } from './workspace-boundary';
import type { WorkspaceBootstrap } from './lib/workspace-bootstrap';

// The authenticated server, not a query parameter or local storage, selects the
// data mode. The approved fixtures are only available in isolated local QA.
const element = document.getElementById('ops-desktop-bootstrap');
let bootstrap: { mode?: string; workspace?: WorkspaceBootstrap } = {};
try {
  bootstrap = JSON.parse(element?.textContent || '{}');
} catch {
  // An unprocessed static artifact must never silently show simulated data.
}
const root = document.getElementById('root');
if (!root) throw new Error('OpsCenter mount point is missing.');
if (bootstrap.mode === 'reference') {
  createRoot(root).render(<Home />);
} else if (bootstrap.mode === 'command-live') {
  installMaintenanceTelemetry();
  // Start the selected Convoy read alongside shell rendering and code loading.
  const navigation = new URLSearchParams(window.location.search);
  if (bootstrap.workspace && navigation.get('workspace') === 'Fleet') {
    void fetchWorkspace(fleetSnapshotUrl(bootstrap.workspace.date, navigation.get('fleetView') || 'overview'), AbortSignal.timeout(30_000)).catch(() => {});
  }
  // Dispatch's first read must start before unrelated Command preparation.
  // LiveSchedule joins this same request and still owns refresh/error handling.
  if (bootstrap.workspace && navigation.get('workspace') === 'Schedule') {
    const selectedDate = new Date(`${bootstrap.workspace.date}T12:00:00Z`);
    if (navigation.get('scheduleDay') === 'tomorrow') selectedDate.setUTCDate(selectedDate.getUTCDate()+1);
    void fetchWorkspace(`/api/desktop/schedule?date=${selectedDate.toISOString().slice(0,10)}&load=1`, AbortSignal.timeout(30_000)).catch(() => {});
  }
  createRoot(root).render(<WorkspaceBoundary root><LiveCommand bootstrap={bootstrap.workspace} /></WorkspaceBoundary>);
} else {
  root.textContent = 'The desktop release is not ready. No operational changes were made.';
}

import './driving-scores.css';

import './opscenter-brand.css';
