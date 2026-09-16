import { CampaignLeads, CampaignResults, CampaignReviews, campaignOutcomes } from './campaign-workspace';
import { workspaceReady } from './navigation-performance';
import { useWorkspaceSnapshot } from './use-workspace-snapshot';
import { fetchWorkspace } from './lib/workspace-cache';
import { useWorkspaceRefresh, WorkspaceFreshness } from './workspace-freshness';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { commercialDate, type MarketingData, type MarketingView, type Lead, type Review, type CommercialOperation, type CommercialReceipt } from './lib/commercial-contract';

export type LiveMarketingProps = { date: string; view?: string; report?: (message: string) => void; onBusyChange?: (busy: boolean) => void; onViewChange?: (view: MarketingView) => void };
export function LiveMarketing({ date, view = 'overview', report, onBusyChange }: LiveMarketingProps) {
  const snapshotKey = `/api/desktop/marketing?date=${date}`;
  const [data, setData] = useWorkspaceSnapshot<MarketingData>(snapshotKey);
  const [revision, setRevision] = useState(0);
  const [actionFeedback, setActionFeedback] = useState(''), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Lead | null>(null), [selections, setSelections] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<'lead' | Review | null>(null);
  const [lastRequest, setLastRequest] = useState(''), [unresolved, setUnresolved] = useState(false);
  const confirmationDialog = useRef<HTMLDialogElement>(null);
  const locked = busy || unresolved;
  const editing = locked || Boolean(draft) || Boolean(confirmation) || Object.keys(selections).length > 0;
  const loadSnapshot = useCallback(async (signal: AbortSignal) => {
    const payload = await fetchWorkspace<MarketingData>(snapshotKey, signal);
    if (!signal.aborted) setData(payload);
  }, [snapshotKey, setData]);
  useEffect(() => { if (data) workspaceReady('Marketing'); }, [data]);
  const freshness = useWorkspaceRefresh(loadSnapshot, `${date}:${revision}`, editing, 30_000, snapshotKey);
  useEffect(() => { if (actionFeedback) report?.(actionFeedback); }, [actionFeedback, report]);
  useEffect(() => { onBusyChange?.(editing); return () => onBusyChange?.(false); }, [editing, onBusyChange]);
  useEffect(() => {
    if (!confirmation) return;
    const prior = document.activeElement as HTMLElement | null;
    confirmationDialog.current?.showModal();
    return () => { confirmationDialog.current?.close(); if (prior?.isConnected) prior.focus({ preventScroll: true }); };
  }, [confirmation]);
  function acceptReceipt(receipt: CommercialReceipt) {
    setActionFeedback(receipt.message);
    setUnresolved(receipt.status !== 'verified');
    if (receipt.status === 'verified') { setDraft(null); setSelections({}); setConfirmation(null); setRevision(value => value + 1); }
  }
  async function checkReceipt() {
    if (!lastRequest || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/desktop/marketing?date=${date}&receipt=${lastRequest}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Saved result unavailable.');
      acceptReceipt(result.receipt);
    } catch (error) { setActionFeedback(error instanceof Error ? error.message : 'Saved result unavailable.'); }
    finally { setBusy(false); }
  }
  async function mutate(operation: Omit<CommercialOperation, 'date' | 'requestId'>) {
    if (locked) return;
    setBusy(true); setUnresolved(true); onBusyChange?.(true); setActionFeedback('');
    const requestId = crypto.randomUUID(); setLastRequest(requestId);
    try {
      const response = await fetch('/api/desktop/marketing', { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...operation, date, requestId }) });
      const result = await response.json();
      if (!response.ok) {
        // Only a definite pre-write rejection permits editing/retrying. An uncertain
        // response stays locked to its receipt and must never replay the write.
        if (result.stage === 'preflight' || [401, 403].includes(response.status)) { setUnresolved(false); setLastRequest(''); setActionFeedback(result.error || 'Change rejected before saving.'); return; }
        throw new Error(result.error || 'Save result unavailable.');
      }
      acceptReceipt(result.receipt);
    } catch (error) { setActionFeedback(`${error instanceof Error ? error.message : 'Result unavailable.'} Check the saved result before continuing.`); }
    finally { setBusy(false); }
  }
  function confirmSave() {
    if (confirmation === 'lead' && draft) void mutate({ action: 'lead.update', recordId: draft.id, expectedVersion: draft.version, values: { status: draft.status, reason: draft.reason, note: draft.note, contacted: draft.contacted } });
    else if (confirmation && confirmation !== 'lead') void mutate({ action: 'review.assign', recordId: confirmation.id, expectedVersion: confirmation.version, values: { appointmentId: selections[confirmation.id] ?? confirmation.attribution?.appointmentId ?? '' } });
  }
  const selectedAppointment = confirmation && confirmation !== 'lead' ? selections[confirmation.id] ?? confirmation.attribution?.appointmentId ?? '' : '';
  const selectedCandidate = confirmation && confirmation !== 'lead' ? confirmation.candidates.find(candidate => candidate.appointmentId === selectedAppointment) : null;
  if (!data) return <section className="campaign-workspace"><WorkspaceFreshness state={freshness}/><div className="campaign-empty" role="status">{freshness.error || 'Loading Campaign sources…'}</div></section>;
  return <section className="campaign-workspace" aria-label="Campaign">
    <WorkspaceFreshness state={freshness} sourceAt={view === 'reviews' ? data.reviewFetchedAt : data.fetchedAt} budgetMinutes={20}/>
    {actionFeedback && <div className="campaign-save-status" role="status"><span>{actionFeedback}</span>{lastRequest && <Button disabled={busy} variant="outline" size="sm" onClick={() => void checkReceipt()}>Check saved result</Button>}</div>}
    {Object.keys(selections).length > 0 && !confirmation && <div className="campaign-save-status"><span>Job match not saved yet.</span><Button variant="outline" size="sm" disabled={locked} onClick={() => setSelections({})}>Discard match changes</Button></div>}
    {['overview', 'leads'].includes(view) && (data.available ? <CampaignLeads key={date} leads={data.leads} draft={draft} locked={locked} onDraft={setDraft} onReview={() => { setActionFeedback(''); setConfirmation('lead'); }}/> : <div className="campaign-panel campaign-empty"><h2>Lead source unavailable</h2><p>{data.error || 'SearchKings leads are unavailable for this period.'}</p></div>)}
    {view === 'reviews' && (data.reviewAvailable ? <CampaignReviews reviews={data.reviews} canAssign={data.canAssignReviews} locked={locked} selections={selections} onSelect={(id, appointment) => setSelections(current => ({ ...current, [id]: appointment }))} onReview={review => { setActionFeedback(''); setConfirmation(review); }}/> : <div className="campaign-panel campaign-empty"><h2>Reviews unavailable</h2><p>{data.reviewError || 'Podium has not supplied reviews. No counts or job matches are assumed.'}</p></div>)}
    {view === 'performance' && (data.available ? <CampaignResults data={data}/> : <div className="campaign-panel campaign-empty"><h2>Results unavailable</h2><p>{data.error || 'SearchKings metrics are unavailable for this period. No sample metrics are substituted.'}</p></div>)}
    <footer className="campaign-source-footer"><span>{data.available ? `${data.range} · SearchKings observed ${commercialDate(data.fetchedAt || '')}` : data.error || 'SearchKings unavailable'}</span><span>{data.reviewAvailable ? `Podium snapshot ${commercialDate(data.reviewFetchedAt || '')}` : data.reviewError || 'Podium unavailable'}</span></footer>
    {confirmation && <dialog ref={confirmationDialog} className="campaign-confirm" aria-labelledby="campaign-confirm-title" onCancel={event => { event.preventDefault(); if (!locked) setConfirmation(null); }}>
      <span className="campaign-eyebrow">Review before saving</span><h2 id="campaign-confirm-title">{confirmation === 'lead' ? 'Save this conversation?' : 'Confirm this job match?'}</h2>
      {confirmation === 'lead' && draft ? <><p>{draft.customer} · {draft.territory}</p><dl><dt>Outcome</dt><dd>{campaignOutcomes.find(([value]) => value === draft.status)?.[1] || draft.status}</dd><dt>Contact</dt><dd>{draft.contacted ? 'Franchise contacted' : 'No contact recorded'}</dd><dt>Reason</dt><dd>{draft.reason.replaceAll('_', ' ') || 'Not recorded'}</dd><dt>Note</dt><dd>{draft.note}</dd></dl><p>This saves the contact outcome in OpsCenter. {draft.appointmentId ? 'The matched JunkWare appointment remains unchanged.' : 'It does not create a booking in JunkWare.'}</p></> : confirmation !== 'lead' && <><p>Review by {confirmation.customer} · {confirmation.location} · {confirmation.stars}/5</p><dl><dt>Appointment</dt><dd>{selectedCandidate?.label || selectedAppointment}</dd></dl><p>This credits the review to the selected completed JunkWare appointment in OpsCenter. The original review stays unchanged.</p></>}
      {actionFeedback && <p role="status">{actionFeedback}</p>}{lastRequest && unresolved && <p className="campaign-receipt">Receipt: {lastRequest}. This save is still unverified; another save is blocked.</p>}
      <footer><Button variant="outline" disabled={locked} onClick={() => setConfirmation(null)}>Back to edit</Button>{unresolved ? <Button disabled={busy} onClick={() => void checkReceipt()}>{busy ? 'Checking…' : 'Check saved result'}</Button> : <Button className="campaign-primary" disabled={busy} onClick={confirmSave}>Confirm & save</Button>}</footer>
    </dialog>}
  </section>;
}
