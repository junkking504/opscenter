import { useEffect, useState } from 'react';
import { ArrowRight, Check, PhoneCall, Play, ShieldCheck, Star, X } from 'lucide-react';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { commercialMoney as moneyValue, commercialDate, type MarketingData, type MarketingView, type Lead, type CommercialOperation, type CommercialReceipt } from './lib/commercial-contract';
/** Root owns navigation; report receives action status messages. */
export type LiveMarketingProps = { date: string; view?: string; report?: (message: string) => void; onBusyChange?: (busy: boolean) => void; onViewChange?: (view: MarketingView) => void };
const safeUrl = (url: string) => /^https?:\/\//i.test(url) ? url : undefined;
const safeRate = (n: number, d: number | null) => d ? (100 * n / d).toFixed(1) : '—';
const safeRatio = (n: number, d: number) => d ? (n / d).toFixed(2) : '—';
const label = (status: string) => status === 'needs_follow_up' ? 'Needs follow-up' : status === 'unqualified' ? 'Not qualified' : status === 'booked' || status === 'recovered' ? 'Booked' : 'Lost';
function PhoneContact({ phone }: { phone: string }) { return phone ? <a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>{phone}</a> : <span>Phone unavailable</span>; }
const renderJkLink = (jk: string) => jk ? <a href={`/schedule?job=${encodeURIComponent(jk)}`}>{jk}</a> : <span>No appointment selected</span>;
export function LiveMarketing({ date, view, report, onViewChange, onBusyChange }: LiveMarketingProps) {
  const [data, setData] = useState<MarketingData | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [localView, setLocalView] = useState<MarketingView>('overview');
  const marketingView = (view && ['overview', 'leads', 'reviews', 'performance'].includes(view) ? view : localView) as MarketingView;
  const setMarketingView = (next: MarketingView) => { setLocalView(next); onViewChange?.(next); };
  const [marketingLeadFilter, setMarketingLeadFilter] = useState<'recover' | 'lost' | 'followup' | 'all'>('recover');
  const [actionFeedback, setActionFeedback] = useState(''), [busy, setBusy] = useState(false), [draft, setDraft] = useState<Lead | null>(null), [selections, setSelections] = useState<Record<string, string>>({});
  useEffect(() => { const controller = new AbortController(); setData(null); setError(''); setDraft(null); fetch(`/api/desktop/marketing?date=${date}`, { signal: controller.signal, cache: 'no-store' }).then(async response => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Marketing unavailable.'); setData(payload); }).catch(error => { if (!controller.signal.aborted) setError(error.message); }); return () => controller.abort(); }, [date, revision]);
  useEffect(() => { if (!draft) return; const prior = document.activeElement as HTMLElement | null; document.querySelector<HTMLElement>('[aria-labelledby="commercial-lead-title"] button')?.focus(); return () => { if (prior?.isConnected) prior.focus({ preventScroll: true }); }; }, [draft?.id]);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) setDraft(null); }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [busy]);
  useEffect(() => { if (actionFeedback) report?.(actionFeedback); }, [actionFeedback, report]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const [lastRequest, setLastRequest] = useState('');
  async function checkReceipt() {
    if (!lastRequest || busy) return; setBusy(true); onBusyChange?.(true);
    try { const response = await fetch(`/api/desktop/marketing?date=${date}&receipt=${lastRequest}`, { cache: 'no-store' }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setActionFeedback(result.receipt.message); if (result.receipt.status === 'verified') setRevision(value => value + 1); }
    catch (error) { setActionFeedback(error instanceof Error ? error.message : 'Saved receipt unavailable.'); } finally { setBusy(false); onBusyChange?.(false); }
  }
  async function mutate(operation: Omit<CommercialOperation, 'date' | 'requestId'>) {
    setBusy(true); onBusyChange?.(true); setActionFeedback(''); const requestId = crypto.randomUUID(); setLastRequest(requestId);
    try { const response = await fetch('/api/desktop/marketing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...operation, date, requestId }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); const receipt: CommercialReceipt = result.receipt; setActionFeedback(receipt.message); if (receipt.status === 'verified') { setDraft(null); setRevision(value => value + 1); } }
    catch (error) { setActionFeedback(`${error instanceof Error ? error.message : 'Result unavailable.'} Check saved receipt ${requestId} before retrying.`); } finally { setBusy(false); onBusyChange?.(false); }
  }
  const editLead = (id: string) => setDraft(data?.leads.find(lead => lead.id === id) || null);
  const confirmMarketingReview = (id: string) => { const review = data?.reviews.find(review => review.id === id); if (review) void mutate({ action: 'review.assign', recordId: id, expectedVersion: review.version, values: { appointmentId: selections[id] ?? review.attribution?.appointmentId ?? '' } }); };
  if (!data) return <section className="marketing-workspace"><div className="marketing-empty" role="status">{error || 'Loading Marketing sources…'}</div></section>;
  const marketingLeads = data.leads.map(lead => ({ ...lead, status: label(lead.status), age: commercialDate(lead.calledAt), lastContact: lead.contacted ? `Franchise contacted · ${commercialDate(lead.updatedAt)}` : 'No recorded franchise contact', callDuration: 'Source' }));
  const marketingRecoveryLeads = marketingLeads.filter(lead => ['Lost', 'Needs follow-up', 'Contacted'].includes(lead.status));
  const marketingLostCount = marketingLeads.filter(lead => lead.status === 'Lost').length;
  const visibleMarketingLeads = marketingLeads.filter(lead => marketingLeadFilter === 'all' || marketingLeadFilter === 'lost' ? marketingLeadFilter === 'all' || lead.status === 'Lost' : marketingLeadFilter === 'followup' ? lead.status === 'Needs follow-up' : ['Lost', 'Needs follow-up', 'Contacted'].includes(lead.status));
  const marketingReviews = data.reviews.map(review => ({ ...review, status: review.attribution?.status === 'matched' ? 'Attributed' : 'Needs attribution', age: commercialDate(review.createdAt), selectedAppointment: review.attribution?.appointmentId || '', jk: review.attribution?.jkNumber || '' }));
  const marketingReviewCount = marketingReviews.filter(review => review.status !== 'Attributed').length;
  const todaysMarketingReviews = marketingReviews.filter(review => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(review.createdAt)) === date);
  const todaysReviewAverage = todaysMarketingReviews.length ? todaysMarketingReviews.reduce((sum, review) => sum + review.stars, 0) / todaysMarketingReviews.length : null;
  const marketingTotals = data.totals, marketingSources = data.sources;
  return <>
    <p className="marketing-source-note" role="status">{data.available ? `${data.range} · SearchKings observed ${commercialDate(data.fetchedAt || '')}` : data.error || 'SearchKings source unavailable.'} · {data.reviewAvailable ? `Podium snapshot ${commercialDate(data.reviewFetchedAt || '')}` : data.reviewError || 'Podium unavailable.'}</p>
            <section className={`marketing-workspace marketing-view-${marketingView}`}>
              {actionFeedback && <p className="marketing-feedback" role="status"><Check size={14} />{actionFeedback}</p>}

              {marketingView === 'overview' && data.available && <>
                <div className="marketing-kpi-strip" aria-label="Marketing operating summary">
                  <button className="critical" onClick={() => setMarketingView('leads')}><span>Leads to Recover</span><strong>{marketingRecoveryLeads.length}</strong><small>{marketingLostCount} lost · Highest priority first</small></button>
                  <button onClick={() => setMarketingView('performance')}><span>Qualified Calls</span><strong>{marketingTotals.qualified}</strong><small>{marketingTotals.calls} total SearchKings calls</small></button>
                  <button onClick={() => setMarketingView('performance')}><span>Matched JunkWare Bookings</span><strong>{marketingTotals.bookings}</strong><small>{data.jobChange}</small></button>
                  <button onClick={() => setMarketingView('performance')}><span>Attributed Completed Revenue</span><strong>{moneyValue(marketingTotals.revenue)}</strong><small>Completed JunkWare appointments only</small></button>
                  <button className="attention" onClick={() => setMarketingView('reviews')}><span>Reviews on Selected Day</span><strong>{data.reviewAvailable ? todaysMarketingReviews.length : 'Unavailable'}</strong><small>{!data.reviewAvailable ? 'Podium source unavailable' : todaysReviewAverage == null ? 'No reviews on selected day' : `${todaysReviewAverage.toFixed(1)} average · ${todaysMarketingReviews.filter((review) => review.status === 'Needs attribution').length} need attribution`}</small></button>
                </div>

                <div className="marketing-overview-grid">
                  <section className="marketing-recovery-shell">
                    <div className="section-title"><div><span className="section-kicker">SearchKings · Lost first</span><h2>Lead Recovery</h2><p>Customer, intent, value, contact history, and outcome controls stay in one row.</p></div><Button variant="ghost" size="sm" onClick={() => setMarketingView('leads')}>View All <ArrowRight /></Button></div>
                    <div className="marketing-lead-head"><span>Lead</span><span>Need</span><span>Quoted Value</span><span>Contact</span><span>Status</span><span /></div>
                    <div className="marketing-lead-list">{marketingRecoveryLeads.slice(0, 4).map((lead) => <article className={lead.status === 'Lost' ? 'lost' : 'followup'} key={lead.id}>
                      <div><strong>{lead.customer}</strong><small>{lead.territory} · {lead.age}</small></div>
                      <div><strong>{lead.intent}</strong><small>{lead.reason}</small></div>
                      <strong>{moneyValue(lead.quotedValue)}</strong>
                      <div><PhoneContact phone={lead.phone} /><small>{lead.lastContact}</small></div>
                      <span className={`marketing-lead-status ${lead.status.toLowerCase().replaceAll(' ', '-')}`}>{lead.status}</span>
                      <div className="marketing-row-actions"><a href={`tel:+1${lead.phone.replace(/\D/g, '')}`} aria-label={`Call ${lead.customer}`}><PhoneCall size={13} /></a><button onClick={() => editLead(lead.id)}>Update</button></div>
                    </article>)}</div>
                  </section>

                  <aside className="marketing-attention-shell">
                    <div className="section-title"><div><span className="section-kicker">Needs action</span><h2>Marketing Exceptions</h2></div></div>
                    <button onClick={() => setMarketingView('reviews')}><span className="exception-count attention">{marketingReviewCount}</span><div><strong>Reviews need attribution</strong><small>Confirm the proposed customer and JK number.</small></div><ArrowRight size={14} /></button>
                    <button onClick={() => setMarketingView('leads')}><span className="exception-count critical">{marketingRecoveryLeads.filter(lead => !lead.contacted).length}</span><div><strong>Lost leads have no outbound contact</strong><small>Source-recorded franchise contact flag.</small></div><ArrowRight size={14} /></button>
                    <button onClick={() => setMarketingView('performance')}><span className="exception-count">{data.leads.filter(lead => !lead.appointmentId).length}</span><div><strong>Calls without matched appointments</strong><small>Review phone matches before crediting a booking.</small></div><ArrowRight size={14} /></button>
                    <div className="marketing-source-note"><span>Source boundary</span><strong>SearchKings identifies demand. JunkWare confirms bookings and completed revenue.</strong></div>
                  </aside>
                </div>

                <section className="marketing-funnel-shell">
                  <div className="section-title"><div><span className="section-kicker">Selected month · Reconciled funnel</span><h2>Demand to Completed Revenue</h2></div><Button variant="ghost" size="sm" onClick={() => setMarketingView('performance')}>Performance Detail <ArrowRight /></Button></div>
                  <div className="marketing-funnel">
                    <article><span>SearchKings Calls</span><strong>{marketingTotals.calls}</strong><small>All tracked calls</small></article>
                    <i><ArrowRight /></i><article><span>Qualified Calls</span><strong>{marketingTotals.qualified}</strong><small>{safeRate(marketingTotals.qualified, marketingTotals.calls)}% of calls</small></article>
                    <i><ArrowRight /></i><article><span>Matched Bookings</span><strong>{marketingTotals.bookings}</strong><small>{safeRate(marketingTotals.bookings, marketingTotals.qualified)}% of qualified</small></article>
                    <i><ArrowRight /></i><article><span>Completed Jobs</span><strong>{marketingTotals.completed}</strong><small>Verified in JunkWare</small></article>
                    <i><ArrowRight /></i><article><span>Completed Revenue</span><strong>{moneyValue(marketingTotals.revenue)}</strong><small>Revenue authority: JunkWare</small></article>
                  </div>
                </section>
              </>}

              {marketingView === 'leads' && <section className="marketing-leads-shell">
                <div className="section-title"><div><span className="section-kicker">{visibleMarketingLeads.length} shown · SearchKings</span><h2>Leads to Recover</h2><p>Lost leads remain first; direct calling and outcome updates do not require another screen.</p></div><div className="marketing-filters">{([['recover', 'Recover'], ['lost', 'Lost'], ['followup', 'Follow-Up'], ['all', 'All']] as const).map(([key, label]) => <button className={marketingLeadFilter === key ? 'active' : ''} onClick={() => setMarketingLeadFilter(key)} key={key}>{label}</button>)}</div></div>
                <div className="marketing-lead-head detailed"><span>Lead</span><span>Need</span><span>Quoted Value</span><span>Call</span><span>Contact History</span><span>Status</span><span>Outcome</span></div>
                <div className="marketing-lead-list detailed">{visibleMarketingLeads.length ? visibleMarketingLeads.map((lead) => <article className={lead.status === 'Lost' ? 'lost' : lead.status === 'Needs follow-up' ? 'followup' : 'resolved'} key={lead.id}>
                  <div><strong>{lead.customer}</strong><PhoneContact phone={lead.phone} /><small>{lead.territory} · {lead.source}</small></div>
                  <div><strong>{lead.intent}</strong><small>{lead.reason}</small></div>
                  <strong>{moneyValue(lead.quotedValue)}</strong>
                  <a className="marketing-recording" href={safeUrl(lead.sourceUrl)} target="_blank" rel="noreferrer"><Play size={12} />Open Source</a>
                  <div><strong>{lead.lastContact}</strong><small>Inbound call · {lead.age}</small></div>
                  <span className={`marketing-lead-status ${lead.status.toLowerCase().replaceAll(' ', '-')}`}>{lead.status}</span>
                  <div className="marketing-outcome-actions"><a href={`tel:+1${lead.phone.replace(/\D/g, '')}`}><PhoneCall size={12} />Call</a><button onClick={() => editLead(lead.id)}>Update</button></div>
                </article>) : <div className="marketing-empty"><strong>No leads match this view.</strong><span>Change the filter or clear the global search.</span></div>}</div>
              </section>}

              {marketingView === 'reviews' && data.reviewAvailable && <section className="marketing-reviews-shell">
                <div className="section-title"><div><span className="section-kicker">Podium · {marketingReviewCount} need confirmation</span><h2>Review Attribution</h2><p>Name matches are proposals only. Confirm or reassign the JK number before crediting the review.</p></div><Badge variant="outline">{new Set(marketingReviews.map(review => review.location)).size} source locations</Badge></div>
                <div className="marketing-review-summary"><article><span>Reviews Loaded</span><strong>{marketingReviews.length}</strong><small>Read-only Podium source</small></article><article><span>Need Attribution</span><strong>{marketingReviewCount}</strong><small>Manager confirmation required</small></article><article><span>Attributed</span><strong>{marketingReviews.length - marketingReviewCount}</strong><small>Verified source / manager attribution</small></article><article><span>Average Rating</span><strong>{marketingReviews.length ? (marketingReviews.reduce((sum, review) => sum + review.stars, 0) / marketingReviews.length).toFixed(1) : 'Unavailable'}</strong><small>Current review set</small></article></div>
                <div className="marketing-review-grid">{marketingReviews.map((review) => <article className={review.status === 'Attributed' ? 'attributed' : ''} key={review.id}>
                  <div className="marketing-review-heading"><div><span className="review-stars">{Array.from({ length: review.stars }).map((_, index) => <Star fill="currentColor" size={12} key={index} />)}</span><strong>{review.customer}</strong><small>{review.location} · {review.age}</small></div><Badge variant="outline">{review.status}</Badge></div>
                  <p>“{review.excerpt}”</p>
                  <div className="marketing-review-match"><span>Proposed JunkWare appointment</span><input aria-label="Completed appointment ID" placeholder="Source appointment ID" value={selections[review.id] ?? review.selectedAppointment} onChange={event => setSelections(current => ({ ...current, [review.id]: event.target.value }))} list={`review-${review.id}`} /><datalist id={`review-${review.id}`}>{review.candidates.map(candidate => <option key={candidate.appointmentId} value={candidate.appointmentId}>{candidate.label}</option>)}</datalist><div className="marketing-review-job-link">Open {renderJkLink(review.jk || review.selectedAppointment)}</div><small>{review.candidates.length} conservative name-match candidate{review.candidates.length === 1 ? '' : 's'} · Completed jobs only</small></div>
                  {review.status === 'Attributed' && <div className="review-confirmed"><Check size={14} />Attributed as {renderJkLink(review.jk || review.selectedAppointment)}</div>}<Button disabled={busy || !data.canAssignReviews || !(selections[review.id] ?? review.selectedAppointment)} size="sm" onClick={() => confirmMarketingReview(review.id)}>Confirm / Reassign Match</Button>
                </article>)}</div>
              </section>}

              {marketingView === 'performance' && data.available && <section className="marketing-performance-shell">
                <div className="section-title"><div><span className="section-kicker">{data.range} · Source comparison</span><h2>Marketing Performance</h2><p>Calls and demand remain separate from JunkWare-authoritative bookings and completed revenue.</p></div><Badge variant="outline">Selected month</Badge></div>
                <div className="marketing-performance-kpis"><article><span>Total Calls</span><strong>{marketingTotals.calls}</strong><small>SearchKings reporting</small></article><article><span>Qualified</span><strong>{marketingTotals.qualified}</strong><small>{safeRate(marketingTotals.qualified, marketingTotals.calls)}% qualification</small></article><article><span>Matched Bookings</span><strong>{marketingTotals.bookings}</strong><small>Phone match within 7 days</small></article><article><span>Completed Jobs</span><strong>{marketingTotals.completed}</strong><small>Verified in JunkWare</small></article><article><span>Completed Revenue</span><strong>{moneyValue(marketingTotals.revenue)}</strong><small>Attributed completed revenue</small></article><article><span>Paid Media Cost</span><strong>{moneyValue(marketingTotals.cost)}</strong><small>{safeRatio(marketingTotals.revenue, marketingTotals.cost)}× completed ROAS</small></article></div>
                <div className="marketing-performance-head"><span>Territory</span><span>Calls</span><span>Qualified</span><span>Bookings</span><span>Completed</span><span>Completed Revenue</span><span>Cost</span><span>ROAS</span></div>
                <div className="marketing-performance-table">{marketingSources.map((source) => <article key={source.source}><strong>{source.source}</strong><span>{source.calls ?? 'Unavailable'}</span><span>{source.qualified} · {safeRate(source.qualified, source.calls)}%</span><span>{source.bookings}</span><span>{source.completed ?? 'Unavailable'}</span><strong>{moneyValue(source.revenue)}</strong><span>{moneyValue(source.cost)}</span><strong>{source.cost ? `${(source.revenue / source.cost).toFixed(2)}×` : 'No recorded spend'}</strong></article>)}</div>
                <footer className="marketing-performance-note"><ShieldCheck size={14} /><span>Attribution uses normalized phone matching within seven days. A match is a booking signal; revenue appears only after JunkWare marks the appointment completed.</span></footer>
              </section>}
            </section>

    {marketingView === 'reviews' && !data.reviewAvailable && <div className="marketing-empty">Podium reviews unavailable. No review counts or attributions are assumed.</div>}
    {lastRequest && <Button disabled={busy} variant="outline" size="sm" onClick={() => { void checkReceipt(); }}>Check Saved Result</Button>}
    {!data.available && ['overview', 'performance'].includes(marketingView) && <div className="marketing-empty">SearchKings metrics unavailable for this period. No sample metrics are substituted.</div>}
    {draft && <><button className="record-drawer-backdrop" aria-label="Close lead" disabled={busy} onClick={() => setDraft(null)} /><aside className="record-drawer" role="dialog" aria-modal="true" aria-labelledby="commercial-lead-title" onKeyDown={event => { if (event.key !== 'Tab') return; const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]')]; const first = controls[0], last = controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }}><header className="record-drawer-header"><div><span className="section-kicker">SearchKings · Lead recovery</span><h2 id="commercial-lead-title">{draft.customer}</h2></div><button disabled={busy} onClick={() => setDraft(null)} aria-label="Close"><X /></button></header><form onSubmit={event => { event.preventDefault(); void mutate({ action: 'lead.update', recordId: draft.id, expectedVersion: draft.version, values: { status: draft.status, reason: draft.reason, note: draft.note, contacted: draft.contacted } }); }}><div className="record-drawer-body appointment-create-grid"><p>{draft.intent}</p><p><PhoneContact phone={draft.phone} /> · {moneyValue(draft.quotedValue)}</p><label>Recovery outcome<select disabled={Boolean(draft.appointmentId)} value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}>{[['needs_follow_up', 'Needs follow-up'], ['lost', 'Lost'], ['booked', 'Booked (operator reported)'], ['recovered', 'Recovered (operator reported)'], ['unqualified', 'Not qualified']].map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label><label>Reason<select value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })}>{["", "availability", "pricing", "missed_call", "no_follow_up", "competitor", "out_of_area", "service_not_offered", "customer_declined", "other"].map(reason => <option key={reason} value={reason}>{reason ? reason.replaceAll("_", " ") : "No reason recorded"}</option>)}</select></label><label><input type="checkbox" checked={draft.contacted} onChange={event => setDraft({ ...draft, contacted: event.target.checked })} />Franchise contacted</label><label>Contact history / outcome note<textarea required maxLength={2000} value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} /></label><p>Outcome is OpsCenter-owned. Matched appointments keep their JunkWare booking status; contact notes remain editable.</p>{draft.appointmentId && <p>Matched appointment {draft.appointmentId} · {renderJkLink(draft.jk || '')}</p>}</div><footer className="record-drawer-actions"><Button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Save Recovery Outcome'}</Button></footer></form></aside></>}
  </>;
}
