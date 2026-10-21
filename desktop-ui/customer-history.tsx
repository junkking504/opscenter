import { useEffect, useState } from 'react';
import type { CustomerHistory } from './lib/customer-history-contract';
import type { ScheduleAppointment } from './lib/schedule-contract';
import { desktopAppointmentHref, desktopCustomerHref } from './lib/desktop-links';
import { schedulePayment } from './lib/schedule-payment';
import './customer-history.css';

const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function AppointmentCustomerHistory({ job, date, busy = false }: { job: ScheduleAppointment; date: string; busy?: boolean }) {
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const id = job.appointmentId;
  useEffect(() => {
    const controller = new AbortController();
    setHistory(null); setError(''); setExpanded(false);
    if (!/^\d{1,12}$/.test(id)) { setError('Customer history needs a saved appointment.'); return; }
    fetch(`/api/desktop/schedule/customer-history?${new URLSearchParams({ appointment: id, date })}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const data = await response.json().catch(() => null); if (!response.ok || !Array.isArray(data?.records) || !data?.coverage) throw new Error(data?.error || 'Customer history is unavailable. Try again shortly.'); return data as CustomerHistory; })
      .then(data => { if (!controller.signal.aborted) setHistory(data); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Customer history is unavailable.'); });
    return () => controller.abort();
  }, [id, date, retry]);
  const payment = schedulePayment(job);
  const missingQuote = payment.label === 'Estimate quoted' && !job.closeout && !(job.paymentAmount > 0);
  const currentAmount = missingQuote ? 'Quote unavailable' : payment.label === 'Job paid · excluding tips' ? 'Recorded payment · excluding tips' : payment.label === 'Payment needs review' ? 'Recorded amounts conflict' : payment.label;
  return <section className="customer-history" aria-label="Customer history">
    <div className="customer-history-heading"><strong>Customer history</strong><span>Estimates · jobs · payments</span></div>
    {!busy && /^\d{1,12}$/.test(id) && <a className="customer-history-account" href={desktopCustomerHref(id, date)}>Open customer account →</a>}
    <div className="customer-history-current"><span>This appointment</span><strong>{currentAmount}{payment.amount && !missingQuote ? ` · ${payment.amount}` : ''}</strong><small>{payment.details.join(' · ')}</small>{payment.balance && <small>{payment.balance} · recorded in JunkWare</small>}</div>
    {error ? <p role="status">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></p> : !history ? <p role="status">Loading saved history…</p> : <>
      {!history.total && <p>No related appointments found in the available saved history.</p>}
      {history.records.some(row => row.relationship === 'contact') && <p className="customer-history-explanation">Contact matches share the customer name and phone or email. They are possible history, not a merged account.</p>}
      <ul>{history.records.slice(0, expanded ? 30 : 2).map(row => <li key={row.id}>
        <div className="customer-history-row-heading"><span>{row.relationship === 'estimate' ? 'Linked estimate' : row.relationship === 'job' ? 'Linked job' : 'Contact match'}</span><time dateTime={row.date}>{dateLabel(row.date)}</time></div>
        {busy ? <strong>{row.jk || row.id} · {row.type || 'Appointment'}</strong> : <a href={desktopAppointmentHref(row.jk, row.date, row.id)}>{row.jk || row.id} · {row.type || 'Appointment'} <span aria-hidden="true">→</span></a>}
        <small>{row.status || 'Status unavailable'}</small>
        <small>{row.volumes?.join(' · ') || 'Volume not recorded'}</small>
        {row.prices?.map((price, index) => <small key={index}>{price}</small>)}
        <small>{row.amounts.join(' · ') || 'Payment / quote details unavailable'}</small>
        <details><summary>Details</summary><p>{row.customer}{row.address ? ` · ${row.address}` : ''}</p>{row.notes.map((note, index) => <p key={index}>{note}</p>)}<small>{row.observedAt ? `Details saved ${new Date(row.observedAt).toLocaleString('en-US')}` : 'Observation time unavailable'}</small></details>
      </li>)}</ul>
      {history.records.length > 2 && <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : `Show ${history.records.length - 2} more`}</button>}
      <p className="customer-history-coverage">Saved archives: {dateLabel(history.coverage.from)}–{dateLabel(history.coverage.through)}{history.coverage.unreadable > 0 ? ` · ${history.coverage.unreadable} ${history.coverage.unreadable === 1 ? 'file' : 'files'} unavailable; history is incomplete` : ''}. Newer saved schedule updates are included when available.{history.total > history.records.length ? ` Showing ${history.records.length} of ${history.total} related appointments.` : ''} Amounts are source records, not payment verification.</p>
    </>}
  </section>;
}
