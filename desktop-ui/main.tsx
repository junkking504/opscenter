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
  createRoot(root).render(<WorkspaceBoundary root><LiveCommand bootstrap={bootstrap.workspace} /></WorkspaceBoundary>);
} else {
  root.textContent = 'The desktop release is not ready. No operational changes were made.';
}
