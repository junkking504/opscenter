import { useCallback, useEffect, useRef, useState } from 'react';
import { commercialMoney as money } from './lib/commercial-contract';
import './capital-accounting.css';

type Row = { key: string; appointmentId: string; jkNumber: string; date: string; amount: number; method: string; customer: string; billingEmail: string; email: string; crew: string; syncStatus: string; verification?: Verification | null };
export type Verification = { verifiedAt: string; actor: string; synced: boolean; row: Omit<Row, 'key' | 'syncStatus' | 'verification'> };
type Action = 'verify' | 'update' | 'exclude';
type Receipt = { id: string; action: Action; complete?: boolean; message?: string; items: Array<{ row: Row; state: string; message?: string; sourceMessage?: string }> };
type Snapshot = { rows: Row[]; total: number; observedAt: string; options: { groups: Option[]; methods: Option[]; statuses: Option[] }; verifications: Record<string, Verification>; pending: Receipt[] };
type Option = { value: string; label: string };
type Filters = { from: string; to: string; group: string; method: string; status: string };
const defaults = (date: string): Filters => ({ from: date, to: date, group: 'A', method: '', status: 'U' });
const labels = { verify: 'Verify & update QuickBooks', update: 'Update QuickBooks', exclude: 'Exclude from QB' };
const storageKey = 'opscenter.accounting.pending-request';
async function call<T>(body: unknown): Promise<T> {
  const response = await fetch('/api/desktop/accounting', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'Source response unavailable. Use Check saved result if you submitted an action.');
  return result.data;
}
export function CapitalAccounting({ date, onVerifications }: { date: string; onVerifications: (value: Record<string, Verification>) => void }) {
  const [filters, setFilters] = useState(() => defaults(date));
  const [options, setOptions] = useState<Snapshot['options'] | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<{ action: Action; rows: Row[] } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pendingId, setPendingId] = useState(() => { try { return localStorage.getItem(storageKey) || ''; } catch { return ''; } });
  const generation = useRef(0);
  const onMarks = useRef(onVerifications); onMarks.current = onVerifications;
  const load = useCallback(async (next: Filters) => {
    const current = ++generation.current; setBusy(true); setError(''); setSnapshot(null); setSelected([]); setReview(null);
    try { const data = await call<Snapshot>({ mode: 'list', filters: next }); if (current !== generation.current) return; setSnapshot(data); setOptions(data.options); onMarks.current(data.verifications); }
    catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : 'Source unavailable.'); }
    finally { if (current === generation.current) setBusy(false); }
  }, []);
  useEffect(() => { const next = defaults(date); setFilters(next); setReceipt(null); void load(next); }, [date, load]);
  function change(key: keyof Filters, value: string) { setFilters(valueBefore => ({ ...valueBefore, [key]: value })); setSnapshot(null); setSelected([]); setReview(null); }
  const visible = snapshot?.rows.filter(row => [row.jkNumber,row.customer,row.method,row.billingEmail,row.email,row.crew].join(' ').toLowerCase().includes(query.trim().toLowerCase())) || [];
  const chosen = snapshot?.rows.filter(row => selected.includes(row.key)) || [];
  const pending = snapshot?.pending || [];
  const blocked = (row: Row) => pending.some(r => r.items.some(item => item.row.appointmentId === row.appointmentId && ['pending','submitted','uncertain'].includes(item.state)));
  const selectable = visible.filter(row => !blocked(row));
  async function finish(result: Receipt) {
    setReceipt(result); setReview(null);
    if (result.items.every(item => ['verified','failed','not_attempted'].includes(item.state))) { setPendingId(''); localStorage.removeItem(storageKey); }
    await load(filters);
  }
  async function submit() {
    if (!review || busy) return;
    const requestId = crypto.randomUUID();
    // Persist before sending; a lost response or reload keeps the read-only recovery handle.
    try { localStorage.setItem(storageKey, requestId); } catch { setError('This browser could not retain the accounting receipt. Enable site storage before submitting.'); return; }
    setPendingId(requestId); setBusy(true); setError('');
    try { await finish(await call<Receipt>({ mode: 'action', requestId, action: review.action, rows: review.rows })); }
    catch (e) { setReview(null); setError(e instanceof Error ? e.message : 'Check saved result before another submission.'); }
    finally { setBusy(false); }
  }
  async function recover(requestId: string) {
    setBusy(true); setError('');
    try { await finish(await call<Receipt>({ mode: 'recover', requestId })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Saved result unavailable.'); }
    finally { setBusy(false); }
  }
  const canSelect = !busy && !pendingId;
  return <section className="capital-panel capital-accounting" aria-label="JunkWare QuickBooks register">
    <header><div><span className="capital-eyebrow">JUNKWARE ACCOUNTING</span><h3>Review & update QuickBooks</h3><p>Review all jobs, including billed work. Verifying cash or checks also updates QuickBooks through JunkWare.</p></div><a className="capital-button" href="https://junkware.junk-king.com/franchise/accounting/update-quickbooks.aspx" target="_blank" rel="noreferrer">Open JunkWare</a></header>
    <form className="accounting-filters" onSubmit={event => { event.preventDefault(); void load(filters); }}>
      <label>From<input type="date" required value={filters.from} disabled={busy} onChange={e => change('from', e.target.value)}/></label>
      <label>To<input type="date" required value={filters.to} disabled={busy} onChange={e => change('to', e.target.value)}/></label>
      <label>Franchise<select value={filters.group} disabled={busy} onChange={e => change('group',e.target.value)}>{(options?.groups || [{ value: filters.group, label: filters.group === 'A' ? 'All' : 'Selected franchise' }]).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      <label>Payment method<select value={filters.method} disabled={busy} onChange={e => change('method',e.target.value)}>{[{value:'',label:'All'}, {value:'1',label:'Billed'}, {value:'2',label:'Cash'}, {value:'4',label:'Check'}, {value:'3',label:'Credit Card'}].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      <label>JunkWare sync status<select value={filters.status} disabled={busy} onChange={e => change('status',e.target.value)}><option value="U">Unsynced</option><option value="S">Synced</option><option value="E">Excluded</option></select></label>
      <button className="capital-button" disabled={busy} type="submit">{busy ? 'Checking JunkWare…' : 'Refresh register'}</button>
    </form>
    {error && <p className="accounting-notice" role="alert">{error}</p>}
    {(pendingId || pending.length > 0) && <div className="accounting-notice" role="status"><strong>Accounting result needs checking</strong><p>Read the saved result before another submission. This will not send the update again.</p>{Array.from(new Set([pendingId,...pending.map(r => r.id)].filter(Boolean))).map(id => <button key={id} className="capital-button" disabled={busy} onClick={() => void recover(id)}>Check saved result</button>)}</div>}
    {receipt && <div className="accounting-receipt" role="status"><strong>{receipt.complete ? 'Source update confirmed' : 'Review accounting results'}</strong>{receipt.message && <p>{receipt.message}</p>}{receipt.items.map(item => <p key={item.row.key}><b>{item.row.customer} · {item.row.jkNumber} · {money(item.row.amount)}</b> — {item.message || item.state}{item.state !== 'verified' && item.sourceMessage && <small>{item.sourceMessage}</small>}</p>)}</div>}
    {snapshot && <>
      <div className="capital-toolbar"><span>{visible.length} of {snapshot.rows.length} records · <strong>{money(snapshot.total)}</strong> in source register</span><label className="capital-search"><input aria-label="Search QuickBooks register" placeholder="Search jobs, customers or checks" value={query} onChange={e => { setQuery(e.target.value); setSelected([]); setReview(null); }}/></label></div>
      <div className="accounting-actions"><strong>{chosen.length > 50 ? 'Select up to 50 records · ' : ''}{chosen.length} selected · {money(chosen.reduce((sum,row) => sum + row.amount, 0))}</strong>{(['verify','update','exclude'] as Action[]).map(action => <button key={action} className="capital-button" disabled={!canSelect || !chosen.length || chosen.length > 50 || (action === 'verify' ? chosen.some(r => !/^(Cash|Check)\b/i.test(r.method) || r.syncStatus === 'E') : chosen.some(r => r.syncStatus !== 'U'))} onClick={() => setReview({ action, rows: chosen })}>{labels[action]}</button>)}</div>
      {review && <div className="accounting-review" role="region" aria-label="Review accounting action"><h4>{labels[review.action]}</h4><p>{review.action === 'verify' ? 'Confirm that you verified these cash/check payments. Each unsynced record will also be sent to QuickBooks using JunkWare’s native update.' : review.action === 'exclude' ? 'These jobs will be marked Excluded in JunkWare and left out of its QuickBooks sync.' : 'These records will be processed into QuickBooks using JunkWare’s native update.'}</p><ul>{review.rows.map(row => <li key={row.key}>{row.customer} · {row.jkNumber} · {row.method} · <b>{money(row.amount)}</b></li>)}</ul><button className="capital-button primary" disabled={busy} onClick={() => void submit()}>Confirm {review.action === 'verify' ? 'verification & update' : review.action === 'exclude' ? 'exclusion' : 'QuickBooks update'}</button> <button className="capital-button" disabled={busy} onClick={() => setReview(null)}>Cancel</button></div>}
      {visible.length ? <div className="capital-table-scroll"><table className="capital-table accounting-table"><thead><tr><th><input type="checkbox" aria-label="Select all visible accounting records" disabled={!canSelect || !selectable.length} checked={selectable.length > 0 && selectable.every(r => selected.includes(r.key))} onChange={e => { setSelected(e.target.checked ? selectable.map(r => r.key) : []); setReview(null); }}/></th><th>Date / job</th><th>Customer</th><th>Total</th><th>Payment method</th><th>Payment verification</th><th>QuickBooks sync</th><th>Billing / crew</th></tr></thead><tbody>{visible.map(row => <tr key={row.key}><td><input type="checkbox" aria-label={`Select ${row.jkNumber}`} checked={selected.includes(row.key)} disabled={!canSelect || blocked(row)} onChange={e => { setSelected(old => e.target.checked ? [...old,row.key] : old.filter(k => k !== row.key)); setReview(null); }}/></td><td>{row.date}<a href={`/schedule?date=${row.date}&job=${row.jkNumber}`}>{row.jkNumber}</a></td><td><strong>{row.customer}</strong></td><td><strong>{money(row.amount)}</strong></td><td>{row.method}</td><td>{row.verification ? <><span className="capital-status">Verified by manager</span><small>{new Date(row.verification.verifiedAt).toLocaleString()}</small></> : /^(Cash|Check)\b/i.test(row.method) ? 'Needs verification' : row.method === 'Billed' ? 'Billed · receivable' : 'See card evidence below'}</td><td><span className={`capital-status ${row.syncStatus === 'U' ? 'warning' : ''}`}>{row.syncStatus === 'S' ? 'Synced' : row.syncStatus === 'E' ? 'Excluded' : 'Unsynced'}</span>{blocked(row) && <small>Result needs checking</small>}</td><td><details><summary>View details</summary><small>Billing: {row.billingEmail || 'Not provided'}</small><small>Email: {row.email || 'Not provided'}</small><small>Krewe: {row.crew || 'Not provided'}</small></details></td></tr>)}</tbody></table></div> : <p className="accounting-empty">No records match these source filters.</p>}
      <footer>JunkWare observed {new Date(snapshot.observedAt).toLocaleString()} · Billed work is a receivable, not collected payment. Sync status comes from JunkWare; QBO posting evidence is shown separately below.</footer>
    </>}
  </section>;
}
