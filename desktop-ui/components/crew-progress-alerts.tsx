import { requiresAlertAttention } from '../lib/alert-attention';
import { useMemo, useState } from 'react';
import { ChevronRight, CircleHelp, Search, TriangleAlert } from 'lucide-react';
import type { DesktopAlert, DesktopLiveProps } from '../lib/live-contract';
import { crewAlertCardPresentation, type CrewAlertCardPresentation } from '../lib/crew-alert-presentation';
import { CrewAlertPhotos } from './crew-alert-photos';
import './crew-progress-alerts.css';

const clock = (stamp?: string) => stamp && Number.isFinite(Date.parse(stamp)) ? new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(stamp)) : 'Time unavailable';
const eventTime = (alert: DesktopAlert) => Number.isFinite(Date.parse(alert.timestamp || '')) ? Date.parse(alert.timestamp!) : -Infinity;
const factKey = (label: string) => label.toLowerCase().replace(/[^a-z]/g,'').replace(/^(items|pickupitems)$/, 'items').replace(/^(notes|appointmentnotes|keynotes)$/, 'notes');
const territoryClass = (tone: CrewAlertCardPresentation['territoryTone']) => `crew-territory-${tone}`;

export function CrewProgressAlerts({live, openAlert, openControl}: {live: DesktopLiveProps; openAlert: (alert: DesktopAlert) => void; openControl: () => void}) {
  const {snapshot} = live;
  const progress = snapshot.crewProgress;
  const [truck,setTruck] = useState('all');
  const [query,setQuery] = useState('');
  const [followUp,setFollowUp] = useState(false);
  const jobs = progress?.jobs || [];
  const linkedJobs = useMemo(() => new Map(progress?.jobs.flatMap(job => job.updateIds.map(id => [id,job] as const)) || []),[progress]);
  const trucks = [...new Set([...jobs.map(job => job.truck), ...snapshot.alerts.flatMap(alert => alert.truck ? [alert.truck] : [])])].sort((a,b) => a.localeCompare(b,undefined,{numeric:true}));
  const search = query.trim().toLowerCase();
  const orderedUpdates = [...snapshot.alerts].sort((a,b) => eventTime(b) - eventTime(a));
  const latestJobUpdates = new Set(jobs.flatMap(job => {
    const latest = orderedUpdates.find(alert => job.updateIds.includes(alert.id));
    return latest ? [latest.id] : [];
  }));
  const visibleUpdates = orderedUpdates.filter(alert => {
    const job = linkedJobs.get(alert.id);
    return (truck === 'all' || (alert.truck || job?.truck) === truck)
      && (!followUp || requiresAlertAttention(alert))
      && (!search || [alert.title,alert.label,alert.truck,...alert.facts.map(f => f.value),job?.jobNumber,job?.truck,job?.crew,job?.territory,job?.status,...(job?.customerFacts.map(f => f.value) || [])].join(' ').toLowerCase().includes(search));
  });
  const blocked = !snapshot.sources.workflow || Boolean(live.pendingAlertId);

  const renderUpdate = (alert: DesktopAlert) => {
    const job = linkedJobs.get(alert.id);
    const customerFacts = alert.label === 'New Appointment' ? job?.customerFacts || [] : [];
    const customerKeys = new Set(customerFacts.map(fact => factKey(fact.label)));
    const facts = [...alert.facts.filter(fact => !customerKeys.has(factKey(fact.label))),...customerFacts];
    const followUpDetail = job?.needsFollowUp && latestJobUpdates.has(alert.id) ? job.next : '';
    const presentation = crewAlertCardPresentation(alert, job);
    return <article key={alert.id} className={`crew-update${presentation ? ` crew-update-${presentation.kind}` : ''}${followUpDetail ? ' needs-follow-up' : ''}`}>
    <div className="crew-update-time"><time dateTime={alert.timestamp}>{alert.label === 'Arrival' ? alert.facts.find(fact=>fact.label === 'Arrival')?.value || alert.detected : alert.detected}</time><span aria-hidden="true"/></div>
    <div className="crew-update-content">
      <header><div>{presentation ? <div className="crew-event-header"><strong className="crew-update-label">{presentation.label}</strong><span aria-hidden="true">–</span><span className={`crew-territory-pill ${territoryClass(presentation.territoryTone)}`}>{presentation.territory}</span><span aria-hidden="true">–</span><a className="crew-event-job" href={presentation.href}>{presentation.jobNumber}</a><span aria-hidden="true">–</span><strong className="crew-event-window">{presentation.timeSlot}</strong>{presentation.truck && <><span aria-hidden="true">–</span><strong className="crew-event-truck">{presentation.truck}</strong></>}</div> : <><strong className="crew-update-label">{alert.label}</strong><span>{alert.title === alert.label ? '' : alert.title}{job && !alert.truck && !alert.title.includes(job.truck) ? ` · ${job.truck}` : ''}</span></>}</div>{alert.corrected && <em>Updated · {clock(alert.updatedAt)}</em>}</header>
      {presentation?.kind === 'completed' && presentation.completion ? <div className="crew-completed-summary">
        <p><strong>C:</strong> {presentation.completion.customer}<span aria-hidden="true">|</span><strong>D:</strong> {presentation.completion.driver}<span aria-hidden="true">|</span><strong>N:</strong> {presentation.completion.navigator}</p>
        {(presentation.completion.load || presentation.completion.labor || presentation.completion.misc) && <p>{presentation.completion.load && <><strong>Load:</strong> {presentation.completion.load}</>}{presentation.completion.labor && <><span aria-hidden="true">|</span><strong>Labor:</strong> {presentation.completion.labor}</>}{presentation.completion.misc && <><span aria-hidden="true">|</span><strong>Misc:</strong> {presentation.completion.misc}</>}</p>}
        <p><strong>{presentation.label === 'Estimate Completed' ? 'Total' : 'Payment'}:</strong> {presentation.label === 'Estimate Completed' ? presentation.completion.total || 'Not recorded' : presentation.completion.payment || 'Not recorded'}</p>
        <p>{facts.filter(fact=>/^(On-site time|Duration|Arrival|Departure)$/i.test(fact.label) && !(fact.label === 'Duration' && facts.some(other=>other.label === 'On-site time'))).map((fact,index)=><span key={fact.label}>{index > 0 && <span aria-hidden="true">|</span>}<strong>{fact.label}:</strong> {fact.value}</span>)}</p>
      </div> : <dl>{facts.filter(fact=>!(/^(Krewe member|Crew member|Employee)$/i.test(fact.label) && fact.value === alert.title)).map((fact,index) => <div key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd>{fact.href ? <a href={fact.href}>{fact.value}</a> : fact.value}</dd></div>)}</dl>}
      {followUpDetail && <p className="crew-update-follow-up"><TriangleAlert size={13}/><strong>Follow up:</strong> {followUpDetail}</p>}
      <footer><CrewAlertPhotos photos={alert.photos} title={alert.title}/><button type="button" onClick={() => openAlert(alert)}>Open record <ChevronRight size={13}/></button>
        <span>{alert.workflowState === 'in-control' ? 'Follow-up in Control' : alert.workflowState === 'acknowledged' ? 'Reviewed' : alert.workflowState === 'resolved' ? 'Follow-up resolved' : ''}</span>
        {alert.workflowState === 'active' && requiresAlertAttention(alert) && <button type="button" disabled={blocked} onClick={() => void live.onAlertAction(alert.id,'acknowledge')}>Mark reviewed</button>}
        {alert.workflowState === 'in-control' ? <button type="button" onClick={openControl}>Open Control</button> : alert.workflowState !== 'resolved' && <button type="button" disabled={blocked} onClick={() => void live.onAlertAction(alert.id,'add_to_control')}>Follow up in Control</button>}
      </footer>
    </div>
  </article>;
  };

  return <section className="crew-alerts" aria-labelledby="crew-alert-title" id="live-alert-list">
    <header className="crew-alert-heading"><div><span className="crew-eyebrow">Crew execution · {snapshot.date}</span><h2 id="crew-alert-title">Operational updates</h2><p>All crew, appointment, and truck updates in one timeline.</p></div><div className="crew-alert-counts"><strong>{jobs.length}</strong> appointments<span>·</span><strong>{snapshot.sources.alerts ? snapshot.alerts.length : '—'}</strong> updates</div></header>
    {(!progress?.scheduleCurrent || !progress?.visitsCurrent || !progress?.updatesComplete) && <div className="crew-source-notice" role="status"><CircleHelp size={16}/><span>{!progress ? 'Progress evidence is unavailable. Source updates remain visible.' : [!progress.scheduleCurrent && 'Schedule is unavailable or stale.', !progress.visitsCurrent && 'Visit data is unavailable or stale.', !progress.updatesComplete && 'Update history is incomplete.'].filter(Boolean).join(' ')} Available updates remain visible.</span></div>}
    <div className="crew-alert-toolbar">
      <label className="crew-truck-filter">Truck<select aria-label="Filter by truck" value={truck} onChange={event => setTruck(event.target.value)}><option value="all">All trucks</option>{trucks.map(label => <option key={label}>{label}</option>)}</select></label>
      <label className="crew-alert-search"><Search size={15}/><input type="search" aria-label="Search operational updates" placeholder="Search job, crew, or update" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <button type="button" className="crew-follow-filter" aria-pressed={followUp} onClick={() => setFollowUp(!followUp)}>Follow-up only</button>
      {(truck !== 'all' || query || followUp) && <button type="button" className="crew-clear" onClick={() => {setTruck('all');setQuery('');setFollowUp(false);}}>Clear filters</button>}
    </div>
    <div className="crew-timeline-order"><strong>Newest first</strong><span>Reviewed updates stay in this timeline.</span></div>
    <section className="crew-all-updates" aria-label="All operational updates, newest first">{visibleUpdates.length ? visibleUpdates.map(renderUpdate) : <p className="crew-empty">{snapshot.sources.alerts ? 'No updates match these filters.' : 'Update history is unavailable.'}</p>}</section>
    {!snapshot.sources.workflow && <p className="crew-workflow-notice">Review and follow-up actions are unavailable while Control is disconnected. Updates remain visible.</p>}
  </section>;
}
