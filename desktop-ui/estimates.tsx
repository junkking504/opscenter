import { useEffect, useRef, useState } from 'react';
import { AlertPhotos } from './components/alert-details';
import { estimateHref, estimateInScope, estimateLabels, type EstimateChange, type EstimateDisposition, type EstimateRow, type EstimateSnapshot, type EstimateSummary } from './lib/estimate-contract';
import './estimates.css';

const money = (value: number | null) => value == null ? 'Quote unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const stamp = (value: string | null) => value ? new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not recorded';
const filters = [['needs', 'Needs follow-up'], ['verify_booking', 'Verify booking'], ['waiting', 'Waiting on customer'], ['converted', 'Converted'], ['lost', 'Lost / no longer needed']] as const;
type Filter = typeof filters[number][0] | 'overdue' | 'due' | 'unassigned';
const matches = (row: EstimateRow, filter: Filter) => filter === 'needs' ? !['converted','lost'].includes(row.status) : filter === 'overdue' ? row.overdue : filter === 'due' ? row.dueToday : filter === 'unassigned' ? !row.followup.owner && !['converted','lost'].includes(row.status) : row.status === filter;

export function EstimateCommandSummary({ summary }: { summary?: EstimateSummary }) {
  if (!summary) return null;
  return <section className="estimate-command" aria-label="Estimate follow-ups"><div><strong>Estimates</strong><span>{summary.available ? `Recent estimates + all tracked follow-ups · since ${summary.recentStart}` : 'Follow-up source unavailable'}</span></div>{summary.available ? <nav aria-label="Estimates needing attention">{([['overdue','Overdue',summary.overdue],['due','Due today',summary.dueToday],['unassigned','Unassigned',summary.unassigned],['verify_booking','Booking review',summary.review]] as const).map(([filter,label,count]) => <a key={filter} href={`/desktop?workspace=Schedule&scheduleView=estimates&estimateFilter=${filter}`}><b>{count}</b>{label}</a>)}</nav> : <a href="/desktop?workspace=Schedule&scheduleView=estimates">Open Estimates</a>}</section>;
}

export default function Estimates({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const [snapshot, setSnapshot] = useState<EstimateSnapshot | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(() => { const value = new URLSearchParams(window.location.search).get('estimateFilter') || 'needs'; return [...filters.map(item => item[0]),'overdue','due','unassigned'].includes(value) ? value as Filter : 'needs'; });
  const [scope, setScope] = useState('recent');
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState('all');
  const [limit, setLimit] = useState(50);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  async function load() {
    const run = ++sequence.current; setLoading(true); setError('');
    try {
      const response = await fetch('/api/desktop/estimates', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Estimate history unavailable.');
      if (run === sequence.current) setSnapshot(body);
      return body as EstimateSnapshot;
    } catch (failure) { if (run === sequence.current) setError(failure instanceof Error ? failure.message : 'Unable to load estimates.'); throw failure; }
    finally { if (run === sequence.current) setLoading(false); }
  }
  useEffect(() => { void load().catch(() => {}); return () => { sequence.current += 1; }; }, []);
  useEffect(() => { setLimit(50); }, [filter,query,owner,scope]);
  const changeBusy = (value: boolean) => { setBusy(value); onBusyChange?.(value); };
  const selectFilter = (value: Filter) => { setFilter(value); const url = new URL(window.location.href); url.searchParams.set('estimateFilter',value); window.history.replaceState({},'',url); };
  const scoped = snapshot?.rows.filter(row => scope === 'all' || estimateInScope(row,snapshot.recentStart)) || [];
  const searched = scoped.filter(row => (owner === 'all' || owner === 'unassigned' ? owner === 'all' || !row.followup.owner : row.followup.owner === owner) && [row.customer,row.jk,row.phone,row.address,row.territory,row.followup.reason,...row.notes].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const rows = searched.filter(row => matches(row,filter));
  const picked = snapshot?.rows.find(row => row.id === selected);
  return <section className="estimate-workspace" aria-label="Estimates across dates">
    <header className="estimate-heading"><div><span className="estimate-kicker">Customer follow-up · across dates</span><h2>Estimates</h2><p>Quotes given to customers, their next action, and the jobs they become.</p></div><button disabled={busy || loading} onClick={() => void load().catch(() => {})}>{loading ? 'Loading…' : 'Reload records'}</button></header>
    {error && <p className="estimate-error" role="alert">{error} {snapshot && 'The previous snapshot remains visible.'}</p>}
    {notice && <p className="estimate-save-message" role="status">{notice}</p>}
    {!snapshot && !error && <p role="status">Reading estimate history…</p>}
    {snapshot && <><div className="estimate-toolbar"><label>Estimate dates<select value={scope} disabled={busy} onChange={event => setScope(event.target.value)}><option value="recent">Since {snapshot.recentStart} + tracked</option><option value="all">All available history</option></select></label><label>Search<input type="search" placeholder="Customer, JK, phone or notes" value={query} onChange={event => setQuery(event.target.value)} /></label><label>Owner<select value={owner} onChange={event => setOwner(event.target.value)}><option value="all">All owners</option><option value="unassigned">Unassigned</option>{[...new Set(snapshot.rows.map(row => row.followup.owner).filter(Boolean))].sort().map(value => <option key={value}>{value}</option>)}</select></label></div>
      <nav className="estimate-filters" aria-label="Estimate status">{filters.map(([value,label]) => <button key={value} aria-pressed={filter === value} onClick={() => selectFilter(value)}>{label}<b>{searched.filter(row => matches(row,value)).length}</b></button>)}{['overdue','due','unassigned'].includes(filter) && <button aria-pressed="true" onClick={() => selectFilter('needs')}>{filter === 'due' ? 'Due today' : filter === 'overdue' ? 'Overdue' : 'Unassigned'} · Clear ×</button>}</nav>
      <p className="estimate-coverage">{snapshot.coverage.files} saved source days · Read {stamp(snapshot.generatedAt)}. Booking checks span dates; missing links need review because history can be incomplete or stale.{snapshot.coverage.unreadable > 0 && ` ${snapshot.coverage.unreadable} source files could not be read.`} Quote amounts are not revenue.</p>
      {picked && <EstimateDetail key={`${picked.id}:${picked.version}`} row={picked} canWrite={snapshot.canWrite && !error} actor={snapshot.actor} busyChange={changeBusy} close={() => setSelected(null)} reload={load} saved={() => setNotice(`Follow-up for ${picked.jk || picked.id} saved and verified.`)} />}
      <div className="estimate-list" aria-label={`${rows.length} estimates`}><div className="estimate-list-heading"><span>Customer & quote</span><span>Follow-up</span><span>Owner & next action</span><span>Review</span></div>{rows.slice(0,limit).map(row => <article className={`estimate-row${row.overdue ? ' overdue' : ''}`} key={row.id}>
        <div><strong>{row.customer || 'Customer unavailable'}</strong><span>{row.jk || `Appointment ${row.id}`} · {row.territory}</span><b className="estimate-price">{money(row.quote)}</b><small>{row.date} · {row.ageDays} days since appointment</small></div>
        <div><strong className={`estimate-status status-${row.status}`}>{estimateLabels[row.status]}</strong><span>{row.followup.reason || (row.possibleBookings.length ? 'Possible matching job — relationship needs review' : row.canceledBookings.length ? 'Linked job canceled — review next step' : row.status === 'converted' ? 'Source-linked job found' : 'Review quote, customer notes and booking status')}</span><small>Last contact: {stamp(row.followup.lastContactAt)}</small></div>
        <div><strong>{row.followup.owner || 'Unassigned'}</strong><span>{row.followup.nextFollowup || 'Next action not set'}{row.overdue ? ' · Overdue' : row.dueToday ? ' · Due today' : ''}</span><small>{row.bookings.map(job => `${job.jk || job.id} · ${job.date}`).join(' · ')}</small></div>
        <div className="estimate-row-actions"><button disabled={busy} onClick={() => { setSelected(row.id); window.setTimeout(() => document.getElementById('estimate-detail')?.scrollIntoView({block:'start'}),0); }} aria-label={`Review ${row.jk || row.id}`}>Review estimate</button>{row.phone.replace(/\D/g,'').length >= 7 && <a href={`tel:${row.phone.replace(/\D/g,'')}`}>Call {row.phone}</a>}</div>
      </article>)}</div>
      {!rows.length && <p className="estimate-empty">No estimates match these filters. Source coverage is described above.</p>}
      {rows.length > limit && <button onClick={() => setLimit(value => value + 50)}>Show 50 more · {rows.length-limit} remaining</button>}
    </>}
  </section>;
}

function EstimateDetail({ row, canWrite, actor, close, reload, busyChange, saved }: { row: EstimateRow; canWrite: boolean; actor: string; close: () => void; reload: () => Promise<EstimateSnapshot>; busyChange: (busy: boolean) => void; saved: () => void }) {
  const [status,setStatus] = useState<EstimateDisposition>(row.followup.status);
  const [owner,setOwner] = useState(row.followup.owner);
  const [next,setNext] = useState(row.followup.nextFollowup);
  const [reason,setReason] = useState(row.followup.reason);
  const [note,setNote] = useState('');
  const [contacted,setContacted] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [uncertain,setUncertain] = useState(false);
  const pending = useRef<EstimateChange | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); return () => busyChange(false); }, []);
  async function save() {
    if (busy) return;
    const change = pending.current || { requestId: crypto.randomUUID(), id: row.id, expectedVersion: row.version, status, owner, nextFollowup: next, reason, note, contacted };
    pending.current = change; setBusy(true); busyChange(true); setMessage('Saving follow-up…');
    try {
      const response = await fetch('/api/desktop/estimates', { method: 'POST', credentials: 'same-origin', headers: {'Content-Type':'application/json'}, body: JSON.stringify(change), signal: AbortSignal.timeout(30000) });
      const body = await response.json();
      if (!response.ok) { if (response.status < 500) { pending.current = null; setUncertain(false); } else setUncertain(true); throw new Error(body.error || 'Save could not be confirmed.'); }
      if (!body.verified || body.event?.requestId !== change.requestId) { setUncertain(true); throw new Error('Save could not be confirmed.'); }
      const fresh = await reload();
      if (!fresh.rows.find(item => item.id === row.id)?.history.some(event => event.requestId === change.requestId)) throw new Error('Saved history is not visible yet. Retry this same save to check it.');
      pending.current = null; setUncertain(false); setNote(''); setContacted(false); setMessage('Follow-up saved and verified.'); saved();
    } catch (failure) { if (pending.current) setUncertain(true); setMessage(failure instanceof Error ? failure.message : 'Save result is unknown. Retry this same save to check it.'); }
    finally { setBusy(false); busyChange(false); }
  }
  return <section id="estimate-detail" className="estimate-detail" aria-label={`Estimate details for ${row.jk}`}><header><div><span className="estimate-kicker">{row.jk} · Appointment {row.id}</span><h3>{row.customer}</h3><p>{money(row.quote)} quoted · {row.pricing || 'Itemized pricing unavailable'}</p></div><button ref={first} disabled={busy} onClick={close}>Close details</button></header>
    <div className="estimate-detail-grid"><div className="estimate-evidence"><p>{row.address}</p><p>Estimate appointment: {row.date} · Source: {row.sourceStatus} · Observed {stamp(row.observedAt)}</p>
      <div className="estimate-links">{row.phone.replace(/\D/g,'').length >= 7 && <a href={`tel:${row.phone.replace(/\D/g,'')}`}>Call {row.phone}</a>}{row.email && <a href={`mailto:${row.email}`}>Email customer</a>}<a href={estimateHref(row.id)} target="_blank" rel="noopener noreferrer">Open estimate in JunkWare ↗</a></div>
      {row.bookings.length > 0 ? <section><h4>Linked jobs</h4>{row.bookings.map(job => <p key={job.id}><a href={`/desktop?workspace=Schedule&scheduleView=board&date=${job.date}&appointment=${job.id}`}>{job.jk || job.id} · {job.date}</a> · {job.status} · Observed {stamp(job.observedAt)}</p>)}</section> : <><p>No active source-linked job found. Confirm the current booking in JunkWare before contacting the customer.</p><a className="estimate-book" href={estimateHref(row.id)} target="_blank" rel="noopener noreferrer">Schedule job in JunkWare ↗</a><small>Start from this estimate to retain its quote and relationship. Reload after JunkWare has synced; Converted requires a linked job in the source.</small></>}
      {row.possibleBookings.length > 0 && <section><h4>Possible matching jobs — not confirmed conversions</h4>{row.possibleBookings.map(job => <p key={job.id}><a href={estimateHref(job.id)} target="_blank" rel="noopener noreferrer">{job.jk || job.id} · {job.date}</a> · {job.status}</p>)}</section>}
      {row.canceledBookings.length > 0 && <p>Previously linked jobs canceled: {row.canceledBookings.map(job => job.jk || job.id).join(', ')}.</p>}
      <details open><summary>Customer and crew notes · {row.notes.length}</summary>{row.notes.length ? row.notes.map((value,index) => <p key={index}>{value}</p>) : <p>No source notes available.</p>}</details>
      <details><summary>Estimate photos · {row.photos.length}</summary>{row.photos.length ? <AlertPhotos photos={row.photos} /> : <p>No photos available in this snapshot.</p>}</details>
    </div><div>
      {row.status !== 'converted' && <form className="estimate-form" onSubmit={event => { event.preventDefault(); void save(); }}><h4>Next action</h4><fieldset disabled={busy || uncertain || !canWrite}><label>Follow-up status<select value={status} onChange={event => setStatus(event.target.value as EstimateDisposition)}>{(['verify_booking','needs_follow_up','waiting','lost'] as const).map(value => <option key={value} value={value}>{estimateLabels[value]}</option>)}</select></label><label>Owner<input value={owner} maxLength={120} onChange={event => setOwner(event.target.value)} placeholder="One person responsible" required={['waiting','needs_follow_up'].includes(status)} /></label><button type="button" onClick={() => setOwner(actor)}>Assign to me</button><label>Next follow-up date<input type="date" value={next} onChange={event => setNext(event.target.value)} disabled={status === 'lost'} required={['waiting','needs_follow_up'].includes(status)} /></label><label>{status === 'lost' ? 'Lost reason' : 'Reason / next action'}<textarea value={reason} maxLength={500} required onChange={event => setReason(event.target.value)} placeholder="What needs to happen next?" /></label><label className="estimate-checkbox"><input type="checkbox" checked={contacted} onChange={event => setContacted(event.target.checked)} />Record customer contact made now</label><label>Contact or review note<textarea value={note} maxLength={2000} required={contacted} onChange={event => setNote(event.target.value)} placeholder="Method, conversation and outcome" /></label></fieldset><button className="estimate-save" disabled={busy || !canWrite} type="submit">{busy ? 'Saving…' : uncertain ? 'Retry the same save' : 'Save follow-up'}</button><small>Saved in OpsCenter with your name and time. Calling or opening email does not mark the customer contacted.</small></form>}
      {message && <p role="status" className="estimate-save-message">{message}</p>}
      <section className="estimate-history"><h4>Follow-up history</h4>{[...row.history].reverse().map(event => <article key={event.requestId}><strong>{event.contacted ? 'Customer contact' : 'Follow-up updated'} · {stamp(event.at)}</strong><small>{event.actor}</small><p>{estimateLabels[event.after.status]} · {event.after.owner || 'Unassigned'} · {event.after.nextFollowup || 'No next date'}</p><p>{event.after.reason}</p>{event.note && <p>{event.note}</p>}</article>)}{!row.history.length && <p>No OpsCenter follow-up recorded. Review source notes for earlier contact.</p>}</section>
    </div></div>
  </section>;
}
