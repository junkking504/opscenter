import { createRoot } from 'react-dom/client';
import Home from './app/page';
import LiveCommand from './live-command';
import './app/globals.css';

// The authenticated server, not a query parameter or local storage, selects the
// data mode. The approved fixtures are only available in isolated local QA.
const element = document.getElementById('ops-desktop-bootstrap');
let bootstrap: { mode?: string } = {};
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
  createRoot(root).render(<LiveCommand />);
} else {
  root.textContent = 'The desktop release is not ready. No operational changes were made.';
}
