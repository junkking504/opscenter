/* eslint-disable @next/next/no-img-element -- This Vite client serves authenticated, no-store cached media directly; Next image optimization cannot forward session cookies. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ImageIcon } from 'lucide-react';
import { Button } from './components/ui/button';
import { PHOTO_STATES, type PhotoReviewRecord, type PhotoReviewSnapshot } from './lib/photo-review-contract';
import { useWorkspaceRefresh, WorkspaceFreshness } from './workspace-freshness';
import './live-photo-review.css';

const labels = { review: 'Needs review', failed: 'Failed', processing: 'Processing', incoming: 'Incoming' };
const timestamp = (value: string | null) => value ? new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not recorded';

function PhotoDetail({ record, close }: { record: PhotoReviewRecord; close: () => void }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: 'nearest' }); }, []);
  return <section className="photo-review-detail" aria-labelledby="photo-detail-heading" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <header><h3 id="photo-detail-heading" ref={heading} tabIndex={-1}>{record.jk || 'Appointment not identified'} · {record.reasonLabel}</h3><Button variant="outline" size="sm" onClick={close}>Close photo details</Button></header>
    <div className="photo-review-detail-grid">
      <div className="photo-review-preview">
        {record.previewAvailable && !previewFailed ? <img src={`/api/desktop/photos?${new URLSearchParams({ preview: record.id, state: record.state })}`} alt={`Cached WhatsApp photo received ${timestamp(record.receivedAt)}`} onError={() => setPreviewFailed(true)} /> : <p><ImageIcon aria-hidden="true" size={24} /><strong>{previewFailed ? 'Cached preview is no longer available' : 'No cached preview'}</strong><span>The original media may not have been retrieved before this record was held. Reviewing this record does not download or upload a photo.</span></p>}
      </div>
      <div>
        <p className="photo-review-next"><strong>Next step</strong>{record.nextStep}</p>
        <dl><div><dt>Queue state</dt><dd>{labels[record.state]}</dd></div><div><dt>Received · Central time</dt><dd>{timestamp(record.receivedAt)}</dd></div><div><dt>Last outcome · Central time</dt><dd>{timestamp(record.outcomeAt)}</dd></div><div><dt>Sender</dt><dd>{record.sender}</dd></div><div><dt>Photo category</dt><dd>{record.category}</dd></div><div><dt>Recorded attempts</dt><dd>{record.attempts}</dd></div></dl>
        <p className="photo-review-caption"><strong>Message caption</strong>{record.caption || 'No caption recorded.'}</p>
        {record.sourceHref ? <><a className="photo-review-source" href={record.sourceHref}>Review {record.jk} in Schedule <ChevronRight size={14} aria-hidden="true" /></a><p className="photo-review-note">Opens the job reference on the message’s received date ({record.jobDate}). Confirm the intended appointment; this link is not a verified photo match.</p></> : <p className="photo-review-note">A dated job reference is unavailable. Verify the original message and intended appointment before changing this record.</p>}
        <small className="photo-review-note">Record {record.id.slice(0, 12)} · {record.reason}</small>
      </div>
    </div>
  </section>;
}

function PhotoQueue() {
  const [snapshot, setSnapshot] = useState<PhotoReviewSnapshot | null>(null);
  const [filters, setFilters] = useState({ state: 'all', reason: '', sender: '', q: '', page: '1' });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PhotoReviewRecord | null>(null);
  const returnToPhoto = useRef<string | null>(null);
  const query = new URLSearchParams(filters).toString();
  const load = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`/api/desktop/photos?${query}`, { credentials: 'same-origin', cache: 'no-store', signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Photo review is unavailable.');
    if (!signal.aborted) setSnapshot(body);
  }, [query]);
  const freshness = useWorkspaceRefresh(load, query, Boolean(selected));
  const change = (key: 'state' | 'reason' | 'sender' | 'q', value: string) => {
    const next = { ...filters, [key]: value, page: '1' };
    if (new URLSearchParams(next).toString() === query) { void freshness.refresh().catch(() => {}); return; }
    setSnapshot(null); setFilters(next);
  };
  const close = () => { returnToPhoto.current = selected?.id || null; setSelected(null); };
  useEffect(() => {
    if (!selected && returnToPhoto.current) {
      document.querySelector<HTMLElement>(`[aria-label="Inspect photo ${returnToPhoto.current.slice(0, 12)}"]`)?.focus({ preventScroll: true });
      returnToPhoto.current = null;
    }
  }, [selected]);
  return <div className="photo-review-body" id="photo-review-content">
    <p className="photo-review-note">Current unresolved queue across all dates. Counts are read from the queue now; the received date shows the age of each photo. Reviewing a record leaves its queue state unchanged.</p>
    <WorkspaceFreshness state={freshness} sourceAt={snapshot?.observedAt} budgetMinutes={2} />
    {snapshot && <div className="photo-review-counts" aria-label="Photo queue totals">{PHOTO_STATES.map(state => <div key={state}><strong>{snapshot.unavailableStates.includes(state) ? 'Unavailable' : snapshot.counts[state]}</strong><span>{labels[state]}</span></div>)}</div>}
    {snapshot && !snapshot.complete && <p className="photo-review-warning" role="alert">Queue view is incomplete. {snapshot.unavailableStates.length > 0 && `Unavailable: ${snapshot.unavailableStates.map(state => labels[state]).join(', ')}. `}{snapshot.unreadable > 0 && `${snapshot.unreadable} unreadable records are counted but cannot be displayed. `}This does not establish that the queue is clear.</p>}
    {selected ? <PhotoDetail record={selected} close={close} /> : <>
      <form className="photo-review-filters" onSubmit={event => { event.preventDefault(); change('q', search.trim()); }}>
        <label>Queue state<select value={filters.state} onChange={event => change('state', event.target.value)}><option value="all">All unresolved</option>{PHOTO_STATES.map(state => <option key={state} value={state}>{labels[state]}</option>)}</select></label>
        <label>Reason<select value={filters.reason} onChange={event => change('reason', event.target.value)}><option value="">All reasons</option>{snapshot?.reasons.map(reason => <option value={reason.reason} key={reason.reason}>{reason.label} ({reason.count})</option>)}{!snapshot?.reasons.some(reason => reason.reason === filters.reason) && filters.reason && <option value={filters.reason}>Selected reason</option>}</select></label>
        <label>Sender<select value={filters.sender} onChange={event => change('sender', event.target.value)}><option value="">All senders</option>{snapshot?.senders.map(sender => <option value={sender.key} key={sender.key}>{sender.label} ({sender.count})</option>)}{!snapshot?.senders.some(sender => sender.key === filters.sender) && filters.sender && <option value={filters.sender}>Selected sender</option>}</select></label>
        <label className="photo-review-search">Find a photo<input type="search" value={search} maxLength={100} placeholder="JK, caption, date, sender ending…" onChange={event => setSearch(event.target.value)} /></label><Button variant="outline" type="submit">Search</Button>
        {(filters.state !== 'all' || filters.reason || filters.sender || filters.q) && <Button variant="ghost" type="button" onClick={() => { setSearch(''); setSnapshot(null); setFilters({ state: 'all', reason: '', sender: '', q: '', page: '1' }); }}>Clear filters</Button>}
      </form>
      {!snapshot ? <p role="status">{freshness.error || 'Loading photo queue…'}</p> : <>
        <p className="photo-review-note" role="status">{snapshot.filtered} matching records · {snapshot.total} unresolved total · Oldest first{filters.q ? ` · Search: ${filters.q}` : ''}</p>
        {snapshot.records.length ? <div className="photo-review-table-scroll" tabIndex={0} role="region" aria-label="Photo queue records"><table><thead><tr><th scope="col">Received · Central time</th><th scope="col">Sender / job reference</th><th scope="col">Reason</th><th scope="col">State</th><th scope="col">Review</th></tr></thead><tbody>{snapshot.records.map(record => <tr key={`${record.state}:${record.id}`}><td>{timestamp(record.receivedAt)}</td><td><strong>{record.jk || 'No job reference'}</strong><span>{record.sender}</span></td><td>{record.reasonLabel}</td><td>{labels[record.state]}</td><td><Button size="sm" variant="outline" aria-label={`Inspect photo ${record.id.slice(0, 12)}`} onClick={() => { setSelected(record); }}>Inspect{record.previewAvailable && <ImageIcon size={14} aria-label="Cached preview available" />}</Button></td></tr>)}</tbody></table></div> : <p className="photo-review-empty">{snapshot.complete && snapshot.total === 0 ? 'No unresolved photo records in the retrieved queue.' : 'No readable records match these filters.'}</p>}
        <nav className="photo-review-pages" aria-label="Photo queue pages"><Button variant="outline" size="sm" disabled={snapshot.page <= 1 || freshness.pending} onClick={() => { setSnapshot(null); setFilters(previous => ({ ...previous, page: String(snapshot.page - 1) })); }}>Previous photos</Button><span>Page {snapshot.page} of {snapshot.pages}</span><Button variant="outline" size="sm" disabled={snapshot.page >= snapshot.pages || freshness.pending} onClick={() => { setSnapshot(null); setFilters(previous => ({ ...previous, page: String(snapshot.page + 1) })); }}>Next photos</Button></nav>
      </>}
    </>}
  </div>;
}

export default function LivePhotoReview({ canReview = true }: { canReview?: boolean }) {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('photoReview') === '1');
  return <section className="photo-review-panel" aria-labelledby="photo-review-heading"><header><div><h2 id="photo-review-heading">WhatsApp photo review</h2><p>{canReview ? 'Held photos, source references, and recovery next steps' : 'A manager or administrator can review held photos and source references.'}</p></div><Button variant="outline" disabled={!canReview} aria-expanded={canReview && open} aria-controls="photo-review-content" onClick={() => setOpen(value => !value)}>{canReview ? open ? 'Hide photo queue' : 'Review WhatsApp photos' : 'Manager access required'}{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</Button></header>{canReview && open && <PhotoQueue />}</section>;
}
