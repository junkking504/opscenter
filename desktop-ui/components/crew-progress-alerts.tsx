import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Search, Truck, TriangleAlert } from 'lucide-react';
import type { DesktopAlert, DesktopLiveProps } from '../lib/live-contract';
import type { CrewStep } from '../lib/crew-progress-contract';
import { CrewAlertPhotos } from './crew-alert-photos';
import './crew-progress-alerts.css';

const stateLabel: Record<CrewStep['state'], string> = { complete:'Recorded', next:'Next', pending:'Pending', missing:'Follow up', unknown:'Unknown', 'not-required':'Not required' };
const stateIcon = (state: CrewStep['state']) => state === 'complete' ? <Check size={13}/> : state === 'missing' ? <TriangleAlert size={13}/> : state === 'unknown' ? <CircleHelp size={13}/> : <Clock3 size={13}/>;
const clock = (stamp?: string) => stamp && Number.isFinite(Date.parse(stamp)) ? new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(stamp)) : 'Time unavailable';

export function CrewProgressAlerts({live, openAlert, openControl}: {live: DesktopLiveProps; openAlert: (alert: DesktopAlert) => void; openControl: () => void}) {
  const {snapshot} = live;
  const progress = snapshot.crewProgress;
  const [truck,setTruck] = useState('all');
  const [query,setQuery] = useState('');
  const [view,setView] = useState<'jobs'|'updates'>('jobs');
  const [followUp,setFollowUp] = useState(false);
  const [expanded,setExpanded] = useState<Set<string>>(new Set());
  const alerts = useMemo(() => new Map(snapshot.alerts.map(alert => [alert.id,alert])),[snapshot.alerts]);
  const jobs = progress?.jobs || [];
  const trucks = [...new Set([...jobs.map(job => job.truck), ...snapshot.alerts.flatMap(alert => alert.truck ? [alert.truck] : [])])].sort((a,b) => a.localeCompare(b,undefined,{numeric:true}));
  const search = query.trim().toLowerCase();
  const matchingAlert = (alert: DesktopAlert) => !search || `${alert.title} ${alert.label} ${alert.facts.map(f => f.value).join(' ')}`.toLowerCase().includes(search);
  const filteredJobs = jobs.filter(job => (truck === 'all' || job.truck === truck) && (!followUp || job.needsFollowUp)
    && (!search || `${job.jobNumber} ${job.truck} ${job.crew} ${job.territory} ${job.status} ${job.customerFacts?.map(fact=>fact.value).join(' ')}`.toLowerCase().includes(search) || job.updateIds.some(id => alerts.has(id) && matchingAlert(alerts.get(id)!))));
  const unlinked = (progress?.unlinkedUpdateIds || snapshot.alerts.map(alert => alert.id)).flatMap(id => alerts.has(id) ? [alerts.get(id)!] : []);
  const otherUpdates = unlinked.filter(alert => (truck === 'all' || alert.truck === truck) && matchingAlert(alert) && (!followUp || alert.needsAction));
  const visibleIds = new Set([...filteredJobs.flatMap(job => job.updateIds), ...otherUpdates.map(alert => alert.id)]);
  const visibleUpdates = snapshot.alerts.filter(alert => visibleIds.has(alert.id)).sort((a,b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  const groups = [...new Set(filteredJobs.map(job => job.truck))];
  const blocked = !snapshot.sources.workflow || Boolean(live.pendingAlertId);
  const toggle = (id: string) => setExpanded(previous => {const next = new Set(previous); if(next.has(id))next.delete(id);else next.add(id);return next;});

  const renderUpdate = (alert: DesktopAlert) => <article key={alert.id} className="crew-update">
    <div className="crew-update-time"><time dateTime={alert.timestamp}>{alert.label === 'Arrival' ? alert.facts.find(fact=>fact.label === 'Arrival')?.value || alert.detected : alert.detected}</time><span aria-hidden="true"/></div>
    <div className="crew-update-content">
      <header><div><strong>{alert.label}</strong><span>{alert.title}</span></div>{alert.corrected && <em>Updated · {clock(alert.updatedAt)}</em>}</header>
      <dl>{alert.facts.filter(fact=>!(/^(Krewe member|Crew member|Employee)$/i.test(fact.label) && fact.value === alert.title)).map((fact,index) => <div key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd>{fact.href ? <a href={fact.href}>{fact.value}</a> : fact.value}</dd></div>)}</dl>
      <footer><CrewAlertPhotos photos={alert.photos} title={alert.title}/><button type="button" onClick={() => openAlert(alert)}>Open record <ChevronRight size={13}/></button>
        <span>{alert.workflowState === 'in-control' ? 'Follow-up in Control' : alert.workflowState === 'acknowledged' ? 'Reviewed' : alert.workflowState === 'resolved' ? 'Follow-up resolved' : ''}</span>
        {alert.workflowState === 'active' && <button type="button" disabled={blocked} onClick={() => void live.onAlertAction(alert.id,'acknowledge')}>Mark reviewed</button>}
        {alert.workflowState === 'in-control' ? <button type="button" onClick={openControl}>Open Control</button> : alert.workflowState !== 'resolved' && <button type="button" disabled={blocked} onClick={() => void live.onAlertAction(alert.id,'add_to_control')}>Follow up in Control</button>}
      </footer>
    </div>
  </article>;

  return <section className="crew-alerts" aria-labelledby="crew-alert-title" id="live-alert-list">
    <header className="crew-alert-heading"><div><span className="crew-eyebrow">Crew execution · {snapshot.date}</span><h2 id="crew-alert-title">Operational updates</h2><p>Follow each truck, review completed steps, and see what comes next.</p></div><div className="crew-alert-counts"><strong>{jobs.length}</strong> appointments<span>·</span><strong>{snapshot.sources.alerts ? snapshot.alerts.length : '—'}</strong> updates</div></header>
    {(!progress?.scheduleCurrent || !progress?.visitsCurrent || !progress?.updatesComplete) && <div className="crew-source-notice" role="status"><CircleHelp size={16}/><span>{!progress ? 'Progress evidence is unavailable. Source updates remain visible.' : [!progress.scheduleCurrent && 'Schedule is unavailable or stale.', !progress.visitsCurrent && 'Visit data is unavailable or stale.', !progress.updatesComplete && 'Update history is incomplete.'].filter(Boolean).join(' ')} Recorded evidence remains visible; unknown steps need verification.</span></div>}
    <div className="crew-alert-toolbar">
      <div className="crew-view-toggle" aria-label="Update layout"><button type="button" aria-pressed={view === 'jobs'} onClick={() => setView('jobs')}>By truck & job</button><button type="button" aria-pressed={view === 'updates'} onClick={() => setView('updates')}>All updates</button></div>
      <label className="crew-truck-filter">Truck<select aria-label="Filter by truck" value={truck} onChange={event => setTruck(event.target.value)}><option value="all">All trucks</option>{trucks.map(label => <option key={label}>{label}</option>)}</select></label>
      <label className="crew-alert-search"><Search size={15}/><input type="search" aria-label="Search operational updates" placeholder="Search job, crew, or update" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <button type="button" className="crew-follow-filter" aria-pressed={followUp} onClick={() => setFollowUp(!followUp)}>Follow-up only</button>
      {(truck !== 'all' || query || followUp) && <button type="button" className="crew-clear" onClick={() => {setTruck('all');setQuery('');setFollowUp(false);}}>Clear filters</button>}
    </div>
    <div className="crew-step-legend"><span><Check size={13}/>Recorded</span><span><Clock3 size={13}/>Next</span><span><TriangleAlert size={13}/>Follow up</span><span><CircleHelp size={13}/>Unknown</span><small>Reviewed updates stay in the job history.</small></div>
    {view === 'updates' ? <div className="crew-all-updates">{visibleUpdates.length ? visibleUpdates.map(renderUpdate) : <p className="crew-empty">{snapshot.sources.alerts ? 'No updates match this view.' : 'Update history is unavailable.'}</p>}</div> : <>
      {groups.map(label => {
        const truckJobs = filteredJobs.filter(job => job.truck === label);
        const latest = truckJobs.flatMap(job => job.updateIds.flatMap(id => alerts.has(id) ? [alerts.get(id)!] : [])).sort((a,b) => (b.timestamp || '').localeCompare(a.timestamp || ''))[0];
        return <section className="crew-truck-group" aria-label={`${label} progress`} key={label}>
          <header className="crew-truck-heading"><div><Truck size={19}/><h3>{label}</h3><span>{truckJobs.length} appointment{truckJobs.length === 1 ? '' : 's'}</span></div><p>{latest ? `Latest update · ${latest.label} · ${latest.detected}` : 'No operational updates received for these appointments'}</p></header>
          <div className="crew-job-list">{truckJobs.map(job => {
            const events = job.updateIds.flatMap(id => alerts.has(id) ? [alerts.get(id)!] : []);
            const latest = events.at(-1);
            const isExpanded = expanded.has(job.id);
            return <article className={`crew-job-card${job.needsFollowUp ? ' needs-follow-up' : ''}`} key={job.id}>
              <header className="crew-job-heading"><div><a href={job.href}>{job.jobNumber}</a><span>{job.window}</span><span>{job.territory}</span></div><span className="crew-job-status">{job.status}</span></header>
              <p className="crew-job-crew">{job.crew}</p>
              <dl className="crew-job-customer">{job.customerFacts?.map(fact=><div key={fact.label} className={['Pickup items','Key notes'].includes(fact.label) ? 'crew-customer-long' : ''}><dt>{fact.label}</dt><dd>{fact.href ? <a href={fact.href}>{fact.value}</a> : fact.value}</dd></div>)}</dl>
              <ol className="crew-job-steps" aria-label={`${job.jobNumber} required steps`}>{job.steps.map(step => <li key={step.label} className={`crew-step ${step.state}`}><span>{stateIcon(step.state)}<strong>{step.label}</strong></span><small>{stateLabel[step.state]}</small>{step.facts?.length ? <dl className="crew-step-facts">{step.facts.map((fact,index)=><div key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl> : null}<CrewAlertPhotos photos={step.photos} title={job.jobNumber}/><span className="crew-step-detail">{step.detail}</span></li>)}</ol>
              <div className="crew-job-next"><strong>{job.needsFollowUp ? 'Follow up' : 'Next required'}</strong><span>{job.next}</span><a href={job.href}>Open job <ChevronRight size={14}/></a></div>
              <div className="crew-job-latest"><span>{latest ? <><b>{latest.label}</b> · {latest.detected}{latest.corrected && ' · Updated'}</> : 'No updates received yet'}</span><button type="button" aria-expanded={isExpanded} aria-controls={`job-updates-${job.id}`} disabled={!events.length} onClick={() => toggle(job.id)}>{isExpanded ? 'Hide' : 'Show'} {events.length} update{events.length === 1 ? '' : 's'} <ChevronDown size={14}/></button></div>
              {isExpanded && <div className="crew-job-timeline" id={`job-updates-${job.id}`} aria-label={`${job.jobNumber} update history`}><p className="crew-history-label">First to latest · all milestones retained</p>{events.map(renderUpdate)}</div>}
            </article>;
          })}</div>
        </section>;
      })}
      {otherUpdates.length > 0 && <section className="crew-other-updates"><h3>Other operational updates</h3><p>Attendance, receipts, fleet events, and updates without a confirmed appointment match.</p>{otherUpdates.map(renderUpdate)}</section>}
      {!filteredJobs.length && !otherUpdates.length && <p className="crew-empty">{jobs.length || snapshot.alerts.length ? 'No appointments or updates match these filters.' : 'No appointments or updates are available for this date. Check source status above.'}</p>}
    </>}
    {!snapshot.sources.workflow && <p className="crew-workflow-notice">Review and follow-up actions are unavailable while Control is disconnected. Progress remains visible.</p>}
  </section>;
}
