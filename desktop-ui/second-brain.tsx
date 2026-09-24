import KnowledgeTroubleshootingPanel from './knowledge-troubleshooting';
import type { MaintenanceSnapshot } from './lib/maintenance-contract';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Plus, X } from 'lucide-react';
import { KNOWLEDGE_KINDS, KNOWLEDGE_WORKSPACES, KNOWLEDGE_OUTCOMES, outcomeLabel, knowledgeStatus, searchKnowledge, relatedKnowledge, type KnowledgeAction, type KnowledgeDraft, type KnowledgeEntry, type KnowledgeSnapshot } from './lib/knowledge-contract';
import { answerKnowledgeQuestion } from './lib/knowledge-answer';
import { workspaceLabel } from './lib/workspace-labels';
import './second-brain.css';

const kindLabel = { procedure: 'Procedure', decision: 'Decision', incident: 'Incident', discussion: 'Past discussion', pattern: 'Recurring pattern' };
const date = (value: string | null) => value ? new Date(value).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }) : 'Not yet verified';
const blank = (workspace: string): KnowledgeDraft => ({ title: '', summary: '', kind: 'procedure', workspace: KNOWLEDGE_WORKSPACES.includes(workspace as KnowledgeDraft['workspace']) ? workspace as KnowledgeDraft['workspace'] : 'All', body: '', sourceLabel: '', sourceUrl: '', sourceNote: '', owner: 'Mission Control' });

export default function OpsWiki({ workspace, disabled, navigate }: { workspace: string; disabled: boolean; navigate: (workspace: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).has('knowledge'));
  const [snapshot, setSnapshot] = useState<KnowledgeSnapshot | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('All');
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [pageSize, setPageSize] = useState(40);
  const [troubleshooting, setTroubleshooting] = useState<MaintenanceSnapshot | null>(null);
  const [troubleError, setTroubleError] = useState('');
  const [showTroubleshooting, setShowTroubleshooting] = useState(() => new URLSearchParams(window.location.search).get('knowledge') === 'troubleshoot');
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('knowledge'));
  const [draft, setDraft] = useState<KnowledgeDraft | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editVersion, setEditVersion] = useState(0);
  const [verification, setVerification] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState<KnowledgeAction | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [discard, setDiscard] = useState(false);
  const entry = snapshot?.entries.find(item => item.id === selectedId);
  const locked = pending || Boolean(uncertain);

  function link(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('knowledge', id); else url.searchParams.delete('knowledge');
    window.history.replaceState({}, '', url);
  }
  function select(id: string | null) { setShowTroubleshooting(false); setSelectedId(id); setReviewing(false); setVerification(''); setError(''); link(id || '1'); content.current?.scrollTo(0, 0); }
  async function load() {
    const response = await fetch('/api/desktop/knowledge', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Unable to load knowledge. Check your session and try again.');
    const value = await response.json() as KnowledgeSnapshot;
    setSnapshot(value); return value;
  }
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    let active = true;
    fetch('/api/desktop/knowledge', { cache: 'no-store', signal: AbortSignal.timeout(15000) }).then(async response => {
      if (!response.ok) throw new Error('Unable to load knowledge. Check your session and try again.');
      const value = await response.json() as KnowledgeSnapshot; if (active) setSnapshot(value);
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; element?.close(); };
  }, [open]);
  useEffect(() => {
    if (!open || !showTroubleshooting || !snapshot?.canManage) return;
    let active = true;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch('/api/desktop/maintenance', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw new Error('Observer evidence could not refresh.');
        const value = await response.json() as MaintenanceSnapshot;
        if (active) { setTroubleshooting(value); setTroubleError(''); }
      } catch { if (active) setTroubleError('Observer evidence could not refresh. Previous observations may be stale.'); }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 30000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [open, showTroubleshooting, snapshot?.canManage]);
  function close(force = false) {
    if (locked) return;
    if (!force && (draft || reviewing)) { setDiscard(true); return; }
    setDraft(null); setReviewing(false); setDiscard(false); setOpen(false); link(null);
  }
  function edit(value?: KnowledgeEntry) {
    content.current?.scrollTo(0, 0);
    setDraft(value ? { title: value.title, summary: value.summary, body: value.body, kind: value.kind, workspace: value.workspace,
      learning: value.learning, sourceLabel: value.sourceLabel, sourceUrl: value.sourceUrl, sourceNote: value.sourceNote, owner: value.owner } : blank(workspace));
    setEditId(value && !value.id.startsWith('guide-') ? value.id : crypto.randomUUID());
    setEditVersion(value && !value.id.startsWith('guide-') ? value.version : 0);
    setError(''); setNotice('');
  }
  function accept(saved: KnowledgeEntry) {
    setSnapshot(value => value ? { ...value, entries: [...value.entries.filter(item => item.id !== saved.id), saved] } : value);
    setDraft(null); setUncertain(null); setReviewing(false); setDiscard(false); setVerification(''); select(saved.id);
    setNotice(saved.status === 'verified' ? 'Verification recorded. Review is due in 30 days.' : saved.status === 'archived' ? 'Entry archived. It can be restored from Archived.' : 'Saved for review. The entry is shared with managers and administrators.');
  }
  async function submit(action: KnowledgeAction) {
    setPending(true); setError(''); setNotice('');
    let confirmedRejection = false;
    try {
      const response = await fetch('/api/desktop/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action), signal: AbortSignal.timeout(15000) });
      const value = await response.json();
      if (!response.ok) {
        confirmedRejection = response.status < 500;
        if (confirmedRejection) setUncertain(null);
        if (response.status >= 500) setUncertain(action);
        throw new Error(value.error || 'The entry could not be saved.');
      }
      accept(value.entry);
    } catch (reason) {
      if (!confirmedRejection) setUncertain(action);
      setError(reason instanceof Error ? reason.message : 'Save result unavailable. Check the saved result.');
    } finally { setPending(false); }
  }
  async function checkSaved() {
    if (!uncertain) return;
    setPending(true);
    try {
      const value = await load();
      if (!value.available) throw new Error(value.error);
      const saved = value.entries.find(item => item.id === uncertain.id);
      if (saved?.history.some(row => row.requestId === uncertain.requestId)) accept(saved);
      else if (saved && saved.version > uncertain.expectedVersion) { setUncertain(null); setError('Another revision was saved, but this request was not confirmed. Your draft is preserved. Reopen the current entry before applying your changes.'); }
      else { setError('No saved revision was found. Retry uses the same request and cannot duplicate the entry.'); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Read-back unavailable.'); }
    finally { setPending(false); }
  }
  const rows = searchKnowledge(snapshot?.entries || [], query, scope, kind, status, outcome);
  const answerPool = snapshot ? searchKnowledge(snapshot.entries, '', scope, kind, status, outcome) : [];
  const answer = query.trim().length >= 2 && snapshot ? answerKnowledgeQuestion(answerPool, query, Date.parse(snapshot.observedAt)) : null;
  const answerEntry = answer ? answerPool.find(item => item.id === answer.entryId) : null;
  const visibleRows = answerEntry && !rows.some(item => item.id === answerEntry.id) ? [answerEntry, ...rows] : rows;
  const canWrite = snapshot?.canManage && snapshot.available;
  const act = (action: KnowledgeAction['action']) => { if (entry) void submit({ action, id: entry.id, expectedVersion: entry.version, requestId: crypto.randomUUID(), verificationNote: verification }); };
  return <>
    <button className="brain-launch" disabled={disabled} onClick={() => { setOpen(true); link(selectedId || '1'); }}><BookOpen size={17} /><span>OpsWiki</span></button>
    {open && <dialog ref={dialog} className="brain-dialog" aria-labelledby="brain-title" onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); close(); }}>
      <header className="brain-header"><div><p className="brain-eyebrow">OPSCENTER KNOWLEDGE</p><h2 id="brain-title">OpsWiki</h2><p>Past discussions, recurring issues, fixes, and decisions.</p></div><button className="brain-icon" aria-label="Close OpsWiki" disabled={locked} onClick={() => close()}><X size={22} /></button></header>
      <div className="brain-body" ref={content}>
        <p className="brain-authority">Guidance and recorded experience. Check the owning system for current job, payment, payroll, and GPS facts.</p>
        {discard && <div className="brain-message" role="alert">Discard your unsaved changes?<div className="brain-actions"><button onClick={() => setDiscard(false)}>Keep editing</button><button onClick={() => close(true)}>Discard and close</button></div></div>}
        {(error || snapshot?.error) && <div className="brain-message" role="alert">{error || snapshot?.error}{!locked && <button onClick={() => { setError(''); void load().catch(reason => setError(reason.message)); }}>Reload library</button>}</div>}
        {notice && <p role="status" className="brain-notice">{notice}</p>}
        {uncertain && <div className="brain-message"><p>The save result needs a read-back. Your draft is preserved.</p><div className="brain-actions"><button disabled={pending} onClick={() => void checkSaved()}>Check saved result</button><button disabled={pending} onClick={() => void submit(uncertain)}>Retry same request</button></div></div>}
        {showTroubleshooting && !entry && !draft && snapshot?.canManage ? <>
          <button onClick={() => { setShowTroubleshooting(false); link('1'); }}>← Back to library</button>
          {troubleError && <p className="brain-message" role="alert">{troubleError}</p>}
          {!troubleshooting && <p role="status">Reading current observer evidence…</p>}
          <KnowledgeTroubleshootingPanel snapshot={troubleshooting?.troubleshooting} stale={Boolean(troubleError)} onOpen={id => select(id)} />
        </> : draft ? <form className="brain-editor" onSubmit={event => { event.preventDefault(); void submit({ action: 'save', id: editId!, expectedVersion: editVersion, requestId: crypto.randomUUID(), draft }); }}>
          <h3>{editVersion ? 'Edit knowledge' : 'Capture knowledge'}</h3><p>Saved notes are shared with managers and administrators. Do not include passwords, tokens, or unnecessary personal details.</p>
          <fieldset disabled={locked || !canWrite}>
            <label>Title<input required maxLength={160} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
            <div className="brain-fields"><label>Type<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as KnowledgeDraft['kind'] })}>{KNOWLEDGE_KINDS.map(value => <option value={value} key={value}>{kindLabel[value]}</option>)}</select></label><label>Workspace<select value={draft.workspace} onChange={e => setDraft({ ...draft, workspace: e.target.value as KnowledgeDraft['workspace'] })}>{KNOWLEDGE_WORKSPACES.map(value => <option key={value} value={value}>{workspaceLabel(value)}</option>)}</select></label><label>Owner<input required maxLength={120} value={draft.owner} onChange={e => setDraft({ ...draft, owner: e.target.value })} /></label></div>
            {draft.learning && <label>Historical outcome<select value={draft.learning.outcome} onChange={e => setDraft({ ...draft, learning: { ...draft.learning!, outcome: e.target.value as NonNullable<KnowledgeDraft['learning']>['outcome'] } })}>{KNOWLEDGE_OUTCOMES.map(value => <option key={value} value={value}>{outcomeLabel[value]}</option>)}</select></label>}
            <label>Short summary<input required maxLength={400} value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.target.value })} /></label>
            <label>{draft.kind === 'procedure' ? 'Steps and when to use them' : draft.kind === 'decision' ? 'Decision, alternatives, and reason' : 'Problem, cause, resolution, and verification'}<textarea required rows={8} maxLength={16000} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} /></label>
            <div className="brain-fields"><label>Source name<input required maxLength={200} value={draft.sourceLabel} onChange={e => setDraft({ ...draft, sourceLabel: e.target.value })} /></label><label>Source link (optional HTTPS)<input type="url" maxLength={2000} value={draft.sourceUrl} onChange={e => setDraft({ ...draft, sourceUrl: e.target.value })} /></label></div>
            <label>Source reference or evidence<textarea required rows={3} maxLength={3000} placeholder="Where can someone check this? Include a document section, record reference, or dated evidence." value={draft.sourceNote} onChange={e => setDraft({ ...draft, sourceNote: e.target.value })} /></label>
          </fieldset><div className="brain-actions"><button className="brain-primary" type="submit" disabled={locked || !canWrite}>{pending ? 'Saving…' : 'Save for review'}</button><button type="button" disabled={locked} onClick={() => { setDiscard(false); setDraft(null); }}>Discard changes</button></div>
        </form> : entry ? <article className="brain-article">
          <button className="brain-back" disabled={locked} onClick={() => select(null)}>← Back to library</button>
          <div className="brain-tags"><span>{kindLabel[entry.kind]}</span><span>{workspaceLabel(entry.workspace)}</span><span className={`brain-status brain-status-${entry.status}`}>{knowledgeStatus(entry)}</span></div>
          <h3>{entry.title}</h3><p className="brain-summary">{entry.summary}</p>
          {knowledgeStatus(entry) === 'Review due' && <p className="brain-message">The review date has passed. Recheck the source before relying on this guidance.</p>}
          {entry.status === 'draft' && <p className="brain-message">This entry has not been verified. A manager must check the source and record the evidence.</p>}
          {entry.learning && <section className="brain-learning"><strong>{outcomeLabel[entry.learning.outcome]}</strong><p>Recorded {date(entry.learning.recordedAt)}. This describes the historical source; it does not establish current production health.</p><div className="brain-tags">{entry.learning.topics.map(topic => <span key={topic}>{topic}</span>)}</div></section>}
          <div className="brain-text">{entry.body}</div>
          <section className="brain-source"><h4>Source & verification</h4><strong>{entry.sourceLabel}</strong><p>{entry.sourceNote}</p>{entry.sourceUrl && <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">Open source ↗</a>}{entry.sourceExcerpt && <details><summary>Read source excerpt</summary><blockquote>{entry.sourceExcerpt}</blockquote></details>}
            <dl><div><dt>Owner</dt><dd>{entry.owner}</dd></div><div><dt>{entry.status === 'documented' ? 'Documentation reviewed' : 'Last updated'}</dt><dd>{date(entry.updatedAt)}</dd></div><div><dt>Verified against source</dt><dd>{date(entry.verifiedAt)}{entry.verifiedBy && ` · ${entry.verifiedBy}`}</dd></div><div><dt>Review due</dt><dd>{entry.reviewDue ? date(entry.reviewDue) : 'Needs verification'}</dd></div></dl>
            {entry.verificationNote && <p><strong>Verification evidence:</strong> {entry.verificationNote}</p>}
          </section>
          {entry.learning && <section className="brain-related"><h4>Related experience</h4><p>Shared topics suggest where to investigate. Check the dated evidence before applying a fix.</p>{relatedKnowledge(entry, snapshot?.entries || []).map(other => <button key={other.id} disabled={locked} onClick={() => select(other.id)}>{other.title}</button>)}</section>}
          <div className="brain-actions">{entry.workspace !== 'All' && <button disabled={locked} onClick={() => { close(true); navigate(entry.workspace); }}>Open {workspaceLabel(entry.workspace)}</button>}
            {canWrite && (entry.id.startsWith('guide-') ? <button onClick={() => edit(entry)}>Use as new draft</button> : entry.status === 'archived' ? <button disabled={locked} onClick={() => act('restore')}>Restore for review</button> : <><button disabled={locked} onClick={() => edit(entry)}>Edit entry</button><button disabled={locked} onClick={() => { setReviewing(value => !value); setVerification(''); }}>Review & verify</button><button disabled={locked} onClick={() => act('archive')}>Archive entry</button></>)}
          </div>
          {reviewing && <form className="brain-review" onSubmit={event => { event.preventDefault(); act('verify'); }}><label>What did you check against the source?<textarea required maxLength={3000} rows={3} value={verification} disabled={locked} onChange={event => setVerification(event.target.value)} /></label><p>This records your verification of this knowledge entry. It does not verify or change a live job or payment.</p><button className="brain-primary" disabled={locked || !verification.trim()}>Confirm source checked</button></form>}
          {entry.history.length > 0 && <details className="brain-history"><summary>Revision history ({entry.history.length})</summary><ol>{[...entry.history].reverse().map(row => <li key={row.version}>Revision {row.version} · {row.action} · {date(row.at)} · {row.actor}</li>)}</ol></details>}
        </article> : <>
          {snapshot?.canManage && <div className="brain-learning"><strong>{snapshot.entries.filter(item => item.learning && item.status !== 'archived').length} records learned from available history</strong><p>Search across discussions, issue families, and prevention lessons. Historical outcomes and current verification are tracked separately. Unavailable conversations are not included.</p></div>}
          {snapshot?.canManage && <button onClick={() => { setSelectedId(null); setShowTroubleshooting(true); link('troubleshoot'); }}>Troubleshoot current issues</button>}
          <div className="brain-toolbar"><label className="brain-search">Ask OpsWiki<input type="search" placeholder="Ask how something works or why a prior issue happened…" value={query} maxLength={200} onChange={e => { setQuery(e.target.value); setPageSize(40); }} /></label>{canWrite && <button className="brain-primary" onClick={() => edit()}><Plus size={16} />Capture knowledge</button>}</div>
          {answer && <section className={`brain-answer brain-answer-${answer.confidence}`} aria-label="OpsWiki answer"><div><strong>Answer from saved knowledge</strong><span>{answer.status} · {workspaceLabel(answer.workspace)}</span></div><h3>{answer.title}</h3><p>{answer.answer}</p>{answer.detail && <p className="brain-answer-detail">{answer.detail}</p>}<footer><small>{answer.sourceLabel}</small><button onClick={() => select(answer.entryId)}>Open supporting record</button></footer></section>}
          <div className="brain-fields brain-filters"><label>Workspace<select value={scope} onChange={e => { setScope(e.target.value); setPageSize(40); }}>{KNOWLEDGE_WORKSPACES.map(value => <option key={value} value={value}>{value === 'All' ? 'All workspaces' : workspaceLabel(value)}</option>)}</select></label><label>Type<select value={kind} onChange={e => { setKind(e.target.value); setPageSize(40); }}><option value="all">All types</option>{KNOWLEDGE_KINDS.map(value => <option key={value} value={value}>{kindLabel[value]}</option>)}</select></label><label>Status<select value={status} onChange={e => { setStatus(e.target.value); setPageSize(40); }}><option value="all">Active entries</option><option value="review">Needs review / review due</option><option value="verified">Verified</option><option value="documented">Documented guides</option><option value="archived">Archived</option></select></label><label>Historical outcome<select value={outcome} onChange={e => { setOutcome(e.target.value); setPageSize(40); }}><option value="all">All outcomes</option>{KNOWLEDGE_OUTCOMES.map(value => <option key={value} value={value}>{outcomeLabel[value]}</option>)}</select></label></div>
          {!snapshot ? <p role="status">{error ? 'Knowledge could not be loaded.' : 'Loading knowledge…'}</p> : <><p className="brain-count" role="status">{visibleRows.length} {visibleRows.length === 1 ? 'entry' : 'entries'}{scope !== 'All' ? ` relevant to ${workspaceLabel(scope)}` : ' across OpsCenter'} · Search includes steps, source references, and owners.</p>
            <div className="brain-results">{visibleRows.slice(0, pageSize).map(item => <button className="brain-card" key={item.id} onClick={() => select(item.id)}><div className="brain-tags"><span>{kindLabel[item.kind]}</span><span>{workspaceLabel(item.workspace)}</span><span className={`brain-status brain-status-${item.status}`}>{knowledgeStatus(item)}</span></div><h3>{item.title}</h3>{item.learning && <span className="brain-outcome">{outcomeLabel[item.learning.outcome]} · {date(item.learning.recordedAt)}</span>}<p>{item.summary}</p><small>{item.sourceLabel} · {date(item.updatedAt)}</small></button>)}</div>
            {visibleRows.length > pageSize && <button onClick={() => setPageSize(value => value + 40)}>Show more records ({visibleRows.length - pageSize} remaining)</button>}
            {!visibleRows.length && <div className="brain-empty"><h3>No entries match these filters.</h3><p>Try another phrase or look across all workspaces.</p><button onClick={() => { setQuery(''); setScope('All'); setKind('all'); setStatus('all'); setOutcome('all'); setPageSize(40); }}>Reset filters</button></div>}
            {!snapshot.canManage && <p className="brain-count">Managers and administrators can capture and review shared notes.</p>}
          </>}
        </>}
      </div>
    </dialog>}
  </>;
}
