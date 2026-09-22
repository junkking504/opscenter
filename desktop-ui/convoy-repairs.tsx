import { truckDisplayText } from '../lib/junkware-trucks';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ClipboardCheck, Truck, Wrench } from 'lucide-react';
import { Button } from './components/ui/button';
import { sameTruck, truckCondition, duplicateRepair } from './lib/convoy-presentation';
import type { DesktopFleetSnapshot, DesktopFleetTruck, FleetIssueRow } from './lib/people-fleet-contract';
import type { FleetRecord } from './convoy-views';

type Props = {
  snapshot: DesktopFleetSnapshot; trucks: DesktopFleetTruck[]; truckId: string;
  onTruck: (id: string) => void; open: (record: FleetRecord) => void;
};
type Filter = 'all' | 'attention' | 'stop' | 'missing';
const severityLabel = (value: string) => ({ out_of_service: 'Out of service', repair_soon: 'Repair soon', monitor: 'Monitor' }[value] || value.replaceAll('_', ' '));
const updated = (value: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });

export function ConvoyRepairs({ snapshot, trucks, truckId, onTruck, open }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [showResolved, setShowResolved] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousTruck = useRef(truckId);
  useEffect(() => {
    if (previousTruck.current !== truckId) heading.current?.focus();
    previousTruck.current = truckId;
  }, [truckId]);
  const activeFor = (truck: DesktopFleetTruck) => snapshot.issues.filter(issue => sameTruck(issue.truck, truck.id) && issue.status !== 'resolved');
  const attention = (truck: DesktopFleetTruck) => truck.readiness !== 'Ready' || activeFor(truck).length > 0;
  const matches = (truck: DesktopFleetTruck, choice: Filter) => choice === 'all' || (choice === 'attention' ? attention(truck) : choice === 'stop' ? truck.readiness === 'Out of service' : truck.checklist === 'Missing');
  const selected = trucks.find(truck => truck.id === truckId);
  const filters: Array<[Filter, string]> = [['all', 'All trucks'], ['attention', 'Needs attention'], ['stop', 'Out of service'], ['missing', 'Missing inspection']];
  const chooseTruck = (id: string) => { setShowResolved(false); onTruck(id); };

  function repairCard(issue: FleetIssueRow, truck: DesktopFleetTruck) {
    return <article className="convoy-repair-card" key={issue.issueId}>
      <div className="convoy-repair-tags"><span className={`convoy-status ${issue.status === 'resolved' ? 'ready' : issue.severity === 'out_of_service' ? 'stop' : 'attention'}`}>{issue.status === 'resolved' ? 'Resolved' : severityLabel(issue.severity)}</span><span>{issue.status === 'in_progress' ? 'Work in progress' : issue.status === 'open' ? 'Open' : ''}</span></div>
      <h3>{issue.title}</h3>
      {issue.description && <p className="convoy-repair-description">{issue.description}</p>}
      {duplicateRepair(issue, snapshot.issues) && <small>Similar repair also recorded. Check both before closing.</small>}
      <footer><small>Updated {updated(issue.updatedAt)}</small><Button variant="outline" size="sm" onClick={() => open({ kind: 'issue', truck, issue })}>{issue.status === 'resolved' ? 'View repair' : 'Update repair'}<ArrowRight size={14}/></Button></footer>
    </article>;
  }

  if (truckId && !selected) return null;
  if (selected) {
    const active = activeFor(selected);
    const resolved = snapshot.issues.filter(issue => sameTruck(issue.truck, selected.id) && issue.status === 'resolved');
    return <section className="convoy-repair-detail" aria-label={`${selected.label} inspections and repairs`}>
      <div className="convoy-heading"><Button variant="ghost" size="sm" onClick={() => chooseTruck('')}><ArrowLeft size={15}/>Back to trucks</Button><Button size="sm" disabled={!snapshot.canWrite} onClick={() => open({ kind: 'issue', truck: selected })}><Wrench size={15}/>Add repair</Button></div>
      <header className="convoy-repair-title"><h2 ref={heading} tabIndex={-1}>{selected.label}</h2><span className={`convoy-status ${selected.readiness === 'Out of service' ? 'stop' : selected.readiness === 'Ready' ? 'ready' : 'attention'}`}>{truckCondition(selected)}</span></header>
      <section className="convoy-inspection-banner" aria-label="Selected truck inspection"><ClipboardCheck size={22}/><div><h3>Inspection · {selected.checklist}</h3><p>{selected.checklist === 'Missing' ? 'No completed inspection recorded for this day.' : `Inspection for ${snapshot.date}. Recorded findings are shown here.`}</p>{Boolean(selected.inspectionFindings?.length) ? <dl className="convoy-inspection-findings">{selected.inspectionFindings!.map((finding, index) => <div key={index}><dt>{finding.label}</dt><dd>{finding.notes}</dd></div>)}</dl> : selected.checklist !== 'Missing' && <p>{selected.checklist === 'Complete' ? 'No issues recorded in this inspection.' : 'The inspection reported a problem without a written description. Open the original report for details.'}</p>}<small>{selected.inspectionSource}</small></div><div className="convoy-actions">{selected.inspectionHref && <a href={selected.inspectionHref}>View inspection & photos</a>}<Button variant="outline" size="sm" onClick={() => open({ kind: 'checklist', truck: selected })}>{selected.checklist === 'Missing' ? 'Complete checklist' : 'Open checklist'}</Button></div></section>
      <div className="convoy-heading"><div><h3>Active repairs <span className="convoy-count">{active.length}</span></h3><p className="convoy-repair-caption">Open a repair to update its status, cost, or resolution.</p></div></div>
      {active.length ? <div className="convoy-repair-grid">{[...active].sort((a,b) => Number(b.severity === 'out_of_service') - Number(a.severity === 'out_of_service')).map(issue => repairCard(issue, selected))}</div> : <div className="convoy-repair-empty"><Wrench size={20}/><strong>{selected.readiness === 'Unavailable' ? 'Repair records unavailable' : 'No active repairs'}</strong><p>{selected.readiness === 'Unavailable' ? 'Check source details before assuming this truck is ready.' : selected.checklist === 'Problem reported' ? 'The inspection reports a problem. Review the report and add a repair if needed.' : 'Add a repair when a new problem is found.'}</p></div>}
      <Button className="convoy-history-toggle" variant="ghost" aria-expanded={showResolved} onClick={() => setShowResolved(!showResolved)}>{showResolved ? 'Hide' : 'Show'} resolved repairs ({resolved.length})</Button>
      {showResolved && (resolved.length ? <div className="convoy-repair-grid">{resolved.map(issue => repairCard(issue, selected))}</div> : <p className="convoy-repair-caption">No resolved repairs recorded for this truck.</p>)}
    </section>;
  }
  const shown = trucks.filter(truck => matches(truck, filter)).sort((a,b) => Number(b.readiness === 'Out of service') - Number(a.readiness === 'Out of service') || Number(attention(b)) - Number(attention(a)));
  return <section className="convoy-repair-board" aria-label="Inspections and repairs by truck">
    <div className="convoy-repair-filters" aria-label="Filter trucks by condition">{filters.map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}><strong>{trucks.filter(truck => matches(truck, key)).length}</strong><span>{label}</span></button>)}</div>
    <div className="convoy-heading"><div><h2 ref={heading} tabIndex={-1}>{filter === 'all' ? 'Choose a truck' : filters.find(([key]) => key === filter)?.[1]}</h2><p className="convoy-repair-caption">Inspection and repairs together. Open a truck to take action.</p></div><small>{shown.length} of {trucks.length} trucks</small></div>
    <div className="convoy-repair-trucks">{shown.map(truck => { const repairs = activeFor(truck); return <button className="convoy-repair-truck" key={truck.id} onClick={() => chooseTruck(truck.id)} aria-label={truckDisplayText(`Open ${truck.label} inspections and repairs`)}>
      <span className="convoy-repair-truck-heading"><strong><Truck size={17}/>{truck.label}</strong><span className={`convoy-status ${truck.readiness === 'Out of service' ? 'stop' : truck.readiness === 'Ready' ? 'ready' : 'attention'}`}>{truckCondition(truck)}</span></span>
      <span className="convoy-repair-inspection"><ClipboardCheck size={15}/>Inspection: {truck.checklist}</span>
      {Boolean(truck.inspectionFindings?.length) && <span className="convoy-inspection-preview">{truck.inspectionFindings!.map(finding => `${finding.label}: ${finding.notes}`).join(' · ')}</span>}
      <span className="convoy-repair-preview">{repairs.length ? [...new Set(repairs.map(issue => issue.title))].join(' · ') : truck.readiness === 'Unavailable' ? 'Repair records unavailable' : truck.checklist === 'Problem reported' ? 'Review the reported inspection problem' : 'No active repairs'}</span>
      <span className="convoy-repair-truck-footer"><span>{repairs.length} active {repairs.length === 1 ? 'repair' : 'repairs'}</span><span>Open truck <ArrowRight size={14}/></span></span>
    </button>; })}</div>
    {!shown.length && <p className="convoy-repair-empty">No trucks match this filter. Choose All trucks to see the fleet.</p>}
    {snapshot.issues.some(issue => !trucks.some(truck => sameTruck(truck.id, issue.truck))) && <p className="convoy-source-alert">Some repair records cannot be matched to a truck in this day’s fleet.</p>}
  </section>;
}
