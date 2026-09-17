import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import TruckAgents from '../truck-agents';
import type { TruckAgentSnapshot } from '../lib/truck-agent-contract';
import '../app/globals.css';
const date = '2026-09-17', at = new Date().toISOString();
const snapshot: TruckAgentSnapshot = { version: 1, date, generatedAt: at, heartbeatAt: at, canWrite: true, warnings: [], dispatcher: { unassigned: 2, scheduleAt: at, current: true }, agents: Array.from({ length: 9 }, (_, i) => ({ id: `truck-${i + 1}`, truck: `Truck ${i + 1}`, mode: i === 4 ? 'Identity review' : i === 7 ? 'Repair recovery' : 'Readiness review', status: 'ok', heartbeatAt: at, lastSuccessAt: at, summary: { assigned: 2, completed: 1, nextJob: 'JKTEST', load: 'Needs confirmation', gpsAt: at, inspectionAt: at, progress: i === 2 ? { kind: 'nearby', label: 'Stopped nearby — arrival unconfirmed', jobIds: ['synthetic-job'], jobNumbers: ['JKTEST'], observedAt: at, stoppedSince: new Date(Date.parse(at) - 180_000).toISOString(), distanceMeters: 136, detail: 'Outside the 125-metre arrival boundary. Review parking or loading access and the verified address pin.' } : null }, sources: [{ name: 'repairs', observedAt: at, available: true, note: '' }], history: [], recommendations: [{ id: `truck-${i + 1}:example`, version: 'a'.repeat(64), rule: 'repair', title: i === 7 ? 'Reconcile repair status: Fuel' : i === 4 ? 'Verify truck identity and availability' : 'Obtain this day’s inspection', detail: 'Review the recorded evidence and confirm the next action with dispatch.', priority: i === 7 ? 'urgent' : 'next', owner: 'Dispatcher', due: null, href: '#supporting-record', evidence: [{ source: 'repairs', value: 'Synthetic record for UI acceptance', observedAt: at, href: '#supporting-record' }], firstSeenAt: at, changedAt: at, review: null, reviewVersion: 'b'.repeat(64) }] })) };
const receipts = new Map<string, unknown>();
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.pathname !== '/api/desktop/truck-agents') return Response.json({ error: 'Fixture route unavailable' }, { status: 404 });
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body));
    const rec = snapshot.agents.flatMap(a => a.recommendations).find(r => r.id === body.recommendationId)!;
    rec.review = { status: body.status, actor: 'Fixture manager', at: new Date().toISOString(), version: rec.version }; rec.reviewVersion = 'c'.repeat(64);
    const receipt = { requestId: body.requestId, status: 'verified' }; receipts.set(body.requestId, receipt); return Response.json({ receipt });
  }
  if (url.searchParams.has('receipt')) return Response.json({ receipt: receipts.get(url.searchParams.get('receipt') || '') });
  return Response.json(snapshot);
};
function App() { const [truck, setTruck] = useState(''); return <main style={{ padding: 24, maxWidth: 1300, margin: 'auto' }}><h1>Truck agents · Synthetic acceptance</h1><label>Truck <select value={truck} onChange={e => setTruck(e.target.value)}><option value="">All trucks</option>{snapshot.agents.map(a => <option key={a.id}>{a.truck}</option>)}</select></label><TruckAgents date={date} truck={truck || undefined}/><div id="supporting-record">Synthetic supporting record</div></main>; }
createRoot(document.getElementById('root')!).render(<App/>);
