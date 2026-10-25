import { createRoot } from 'react-dom/client';
import { Button } from '../components/ui/button';
import { ActionHints } from '../action-hints';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
import '../approved-workbench.css';
import '../convoy.css';
import '../capital-workspace.css';
import '../financial-statements.css';
import '../action-hints.css';
import '../appointment-closeout.css';
import '../../styles/ops-theme.css';
function Fixture() {
  return <main className="ops-app ops-live" data-css-phase-two="Fleet" style={{ display: 'block' }}><div className="ops-content" style={{ padding: 16 }}>
    <ActionHints/><h1>Theme component audit</h1><p>Synthetic labels; no operational handlers.</p>
    <section><h2>Shared buttons</h2><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Button id="primary">Primary action</Button><Button id="outline" variant="outline">Secondary action</Button><Button id="destructive" variant="destructive">Destructive action</Button><Button id="brand" variant="brand">Brand action</Button>
    </div></section>
    <section className="convoy-workspace"><h2>Fleet service</h2><Button id="fleet-service" className="convoy-primary">Record service</Button> <Button id="fleet-disabled" className="convoy-primary" disabled>Record service disabled</Button> <Button id="fleet-destructive" variant="destructive">Delete repair</Button></section>
    <section><h2>Fleet statuses</h2><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><span id="ready" className="convoy-status ready">Ready</span><span id="attention" className="convoy-status attention">Needs attention</span><span id="stop" className="convoy-status stop">Out of service</span><span id="warn-badge" className="convoy-badge warning">Inspection missing</span></div></section>
    <section className="capital-workspace"><h2>Finance review</h2><p id="finance-warning" className="statement-review">Review required — incomplete statement coverage.</p><span id="finance-status" className="capital-status warning">Incomplete</span></section>
    <section><h2>Appointment controls</h2><div className="closeout-primary-actions"><button id="closeout" className="closeout-primary-button" type="button">Review closeout</button></div></section>
    <section><h2>Control hint</h2><button id="hint-trigger" type="button" data-action-hint="Open the related record">Record details</button></section>
    <section><h2>Entry controls</h2><input aria-label="Search records" placeholder="Search records"/><select aria-label="Filter"><option>All records</option></select><textarea aria-label="Notes" placeholder="Notes"/></section>
  </div></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
