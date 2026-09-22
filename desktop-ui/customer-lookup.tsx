import { useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import type { CustomerDetails, CustomerLookupResult, CustomerSelection } from '../lib/junkware-customer-contract';
export default function CustomerLookup({ selected }: { selected: (customer: CustomerDetails, selection: CustomerSelection) => void }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<CustomerLookupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [used, setUsed] = useState('');
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => () => { generation.current++; }, []);
  async function search(key?: string) {
    if (pending.current || query.trim().length < 2) return;
    pending.current = true; setBusy(true); setError(''); setUsed('');
    if (!key) setResult(null);
    const revision = ++generation.current;
    const searchedQuery = query.trim();
    try {
      const response = await fetch('/api/desktop/schedule/customers', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: searchedQuery, key }), signal: AbortSignal.timeout(100000) });
      const body = await response.json();
      if (revision !== generation.current) return;
      if (!response.ok) throw new Error(body.error || 'Customer search unavailable.');
      if (key) {
        if (!body.customer?.firstName || !body.customer?.lastName || !body.customer?.phone) throw new Error('JunkWare did not return complete customer details. Search again.');
        selected(body.customer, { query: searchedQuery, key });
        setUsed(`${body.customer.firstName} ${body.customer.lastName} selected. Saved contact and address details loaded below.`);
      } else setResult(body);
    } catch (failure) {
      if (revision === generation.current) setError(failure instanceof Error ? failure.message : 'Customer search unavailable.');
    } finally { pending.current = false; setBusy(false); }
  }
  return <section className="appointment-customer-lookup">
    <header><span>Customer</span><strong>Find an existing customer</strong><small>Search JunkWare customer records across appointment dates. Use a full name, last name, email, or phone.</small></header>
    <Input aria-label="Search existing customers" value={query} onChange={event => { generation.current++; setQuery(event.target.value); setResult(null); setError(''); setUsed(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }} placeholder="Full name, last name, email or phone" />
    <Button variant="outline" size="sm" disabled={busy || query.trim().length < 2} onClick={() => void search()}>{busy ? 'Checking JunkWare…' : 'Search JunkWare'}</Button>
    <div role="status" aria-live="polite">{busy && <p>Checking JunkWare customer records…</p>}{error && <p>{error}</p>}{used && <p>{used}</p>}{result && !busy && !result.matches.length && <p>No matching customer returned by JunkWare. Try a last name or phone number.</p>}</div>
    {result?.matches.map(match => <article key={match.key} className="appointment-customer-results"><div><strong>{match.name}</strong><small>{match.phone} · {match.serviceAddress || match.billingAddress}</small><small>{match.appointmentType} record · {match.email}</small></div><Button variant="outline" size="sm" disabled={busy} onClick={() => void search(match.key)}>Use Customer</Button></article>)}
    {result?.hasMore && <p>More matches may be available. Narrow your search with a full name, email, or phone.</p>}
  </section>;
}
