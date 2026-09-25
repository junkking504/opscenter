import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveMarketing } from '../live-marketing';
import type { CommercialOperation, CommercialReceipt, MarketingData, MarketingView } from '../lib/commercial-contract';
import '../app/globals.css';
import '../workspace-density.css';

// Synthetic, in-memory API boundary: this fixture cannot call a real provider or save a real record.
const data: MarketingData = {
  date: '2026-09-16', range: 'Sep 1–16, 2026', fetchedAt: new Date().toISOString(), available: true, error: null,
  canAssignReviews: true, reviewAvailable: true, reviewFetchedAt: new Date().toISOString(), reviewError: null,
  totals: { calls: 284, qualified: 126, bookings: 48, completed: 36, revenue: 14820, cost: 4600 }, jobChange: 'Matched appointments: last 7 days 18 · prior 7 days 14',
  sources: ['Market North', 'Market South', 'Market West'].map((source, index) => ({ source, calls: 90, qualified: 42, bookings: 16, completed: 12, revenue: 4940, cost: index === 2 ? 0 : 2300 })),
  leads: Array.from({ length: 13 }, (_, index) => ({ id: `lead-${index}`, version: 'a'.repeat(64), customer: ['Morgan Taylor', 'Jordan Lee', 'Avery Martin', 'Casey Brown'][index % 4] + (index > 3 ? ` ${index}` : ''), territory: index % 2 ? 'Market North' : 'Market South', phone: '2255550100', duration: index === 0 ? '3:36' : '1:42', recordingUrl: index === 0 ? 'https://calls.searchkings.com/recordings/synthetic.wav' : '', intent: index === 0 ? 'Asked about a garage cleanout and pricing. Wants to know when a team could come out.' : 'Fictional call about furniture removal.', reason: '', note: '', contacted: index % 3 === 0, quotedValue: index === 0 ? null : 350, status: index === 12 ? 'booked' : index % 2 ? 'lost' : 'needs_follow_up', source: 'Google Ads via SearchKings', sourceUrl: '', calledAt: new Date(Date.UTC(2026, 8, 16, 15) - index * 86400000).toISOString(), updatedAt: '2026-09-16T15:00:00Z', appointmentId: index === 12 ? '1001' : null, jk: index === 12 ? 'JK1001' : null, completed: false, revenue: null })),
  reviews: Array.from({ length: 24 }, (_, index) => ({ id: `review-${index}`, version: 'b'.repeat(64), customer: `Sample Reviewer ${index + 1}`, location: index % 2 ? 'Market North' : 'Market South', stars: index % 5 + 1, createdAt: new Date(Date.UTC(2026, 8, 16, 14) - index * 86400000).toISOString(), excerpt: index === 0 ? 'The crew was helpful, but the arrival window was missed and I had to call for an update.' : 'The team was friendly and took care of the cleanup. Fictional review for testing.', sourceUrl: '', needsResponse: index % 3 === 0, attribution: index % 2 ? { status: 'matched', appointmentId: '1001', jkNumber: 'JK1001', crew: ['Crew Alpha', 'Crew Beta'] } : null, candidates: [{ appointmentId: '1001', jkNumber: 'JK1001', label: 'JK1001 · Completed Sep 15 · Sample Customer' }] })),
};
let uncertain = false, posts = 0, receipt: CommercialReceipt | null = null;
let pendingOperation: CommercialOperation | null = null;
function applyOperation(operation: CommercialOperation) {
  if (operation.action === 'lead.update') { const lead = data.leads.find(row => row.id === operation.recordId)!; Object.assign(lead, operation.values, { version: 'c'.repeat(64) }); }
  if (operation.action === 'review.assign') { const review = data.reviews.find(row => row.id === operation.recordId)!; review.attribution = { status: 'matched', appointmentId: String(operation.values.appointmentId), jkNumber: 'JK1001', crew: ['Crew Alpha', 'Crew Beta'] }; review.version = 'c'.repeat(64); }
}
window.fetch = async (input, init) => {
  const url = new URL(String(input), window.location.href);
  if (url.pathname !== '/api/desktop/marketing') throw new Error('Fixture blocked a non-marketing request');
  if (init?.method === 'POST') {
    posts++; document.getElementById('fixture-posts')!.textContent = `Mock saves: ${posts}`;
    const operation = JSON.parse(String(init.body)) as CommercialOperation;
    pendingOperation = operation;
    if (!uncertain) applyOperation(operation);
    receipt = { requestId: operation.requestId, recordId: operation.recordId, action: operation.action, actor: 'synthetic', fingerprint: 'synthetic', status: uncertain ? 'uncertain' : 'verified', updatedAt: new Date().toISOString(), message: uncertain ? 'Mock save result is uncertain.' : 'OpsCenter record saved and read back. External source data is unchanged.' };
    return Response.json({ receipt }, { status: uncertain ? 202 : 200 });
  }
  if (url.searchParams.has('receipt')) { if (pendingOperation) applyOperation(pendingOperation); if (receipt) { receipt.status = 'verified'; receipt.message = 'Saved result verified by mock read-back.'; } return Response.json({ receipt }); }
  return Response.json(data);
};
function Fixture() {
  const [view, setView] = useState<MarketingView>('overview');
  const [locked, setLocked] = useState(false);
  return <main className="ops-live" style={{ maxWidth: 1280, margin: 'auto', padding: '24px clamp(12px, 3vw, 36px)' }}>
    <div style={{ fontSize: 11, marginBottom: 18 }}><strong>SYNTHETIC TEST · No live requests or writes</strong> · <span id="fixture-posts">Mock saves: 0</span><label style={{ marginLeft: 16 }}><input type="checkbox" onChange={event => { uncertain = event.target.checked; }}/>Simulate uncertain save</label><button disabled={locked} onClick={() => { data.available = !data.available; }}>Toggle SearchKings availability (then Refresh)</button></div>
    <h1 style={{ fontSize: 32, fontWeight: 650 }}>Campaign</h1><p style={{ color: '#64706c', margin: '8px 0 20px' }}>Turn interest into booked work. Give great service its credit.</p>
    <nav className="workspace-tabs" role="tablist" style={{ marginBottom: 18 }}>{([['overview', 'Follow up'], ['reviews', 'Reviews'], ['performance', 'Results']] as const).map(([key, label]) => <button role="tab" aria-selected={view === key} className={view === key ? 'active' : ''} disabled={locked} key={key} onClick={() => setView(key)}>{label}</button>)}</nav>
    <LiveMarketing date={data.date} view={view} onBusyChange={setLocked}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
