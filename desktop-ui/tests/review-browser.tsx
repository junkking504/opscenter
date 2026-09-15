import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReviewBrowser } from '../review-browser';
import type { Review } from '../lib/commercial-contract';
import '../app/globals.css';

const reviews: Review[] = Array.from({ length: 42 }, (_, i) => ({
  id: `sample-${i}`, version: 'synthetic', customer: `Sample Reviewer ${i + 1}`,
  location: i % 2 ? 'Market North' : 'Market South', stars: i % 5 + 1,
  excerpt: i === 0 ? 'The team arrived late and did not call ahead.' : 'Fictional review for testing navigation and crew display.',
  createdAt: new Date(Date.UTC(2026, 8, 15, 12) - i * 3600000).toISOString(), sourceUrl: '', needsResponse: i % 3 === 0,
  attribution: i % 2 ? null : { status: 'matched', appointmentId: String(1000 + i), jkNumber: `JK${2000 + i}`, crew: i === 2 ? [] : ['Crew Alpha', 'Crew Beta'] }, candidates: [],
}));
function Fixture() {
  const [selections, setSelections] = useState<Record<string, string>>({});
  return <main style={{ padding: 20, maxWidth: 1300, margin: 'auto' }}><p>Synthetic review navigation · no source requests or writes</p><ReviewBrowser reviews={reviews} canAssign={false} busy={false} selections={selections} onSelect={(id, value) => setSelections(current => ({ ...current, [id]: value }))} onConfirm={() => { throw new Error('No writes permitted'); }} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
