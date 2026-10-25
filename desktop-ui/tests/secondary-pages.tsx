import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import { fixtureSnapshot } from '../../scripts/fixtures/crew-progress';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
import '../approved-workbench.css';
import '../secondary-presentation.css';

const snapshot = fixtureSnapshot();
snapshot.actor.role = 'Manager';
if (!new URLSearchParams(location.search).has('unavailable')) {
  snapshot.sourceHealth = [
    { name: 'Example scheduling source', area: 'Schedule and appointments', workspace: 'Command', action: 'View workspace', state: 'Available', tone: 'healthy', observedAt: new Date().toISOString(), maxAgeSeconds: 3600 },
    { name: 'Example financial source', area: 'Recorded operational costs', workspace: 'Capital', action: 'View workspace', state: 'Incomplete', tone: 'warning', observedAt: null, maxAgeSeconds: 3600, detail: 'Some source observations are missing. Figures remain incomplete until verified.' },
    { name: 'Example vehicle source', area: 'Truck location and inspection observations', workspace: 'Convoy', action: 'View workspace', state: 'Available', tone: 'healthy', observedAt: '2020-01-01T00:00:00Z', maxAgeSeconds: 3600 },
  ];
}
window.fetch = async (_input, init) => {
  if (init?.method && init.method !== 'GET') throw Error('Writes forbidden in secondary-page fixture');
  return Response.json({ error: 'Disabled in synthetic fixture' }, { status: 503 });
};
class NoEvents { addEventListener() {} close() {} }
window.EventSource = NoEvents as unknown as typeof EventSource;
createRoot(document.getElementById('root')!).render(<Home live={{snapshot, pendingAlertId: null, error: '', onDateChange: () => {}, onAlertAction: async () => { throw Error('Writes forbidden'); }}} />);
