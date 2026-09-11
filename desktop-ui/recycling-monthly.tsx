import { useState } from 'react';
import { Button } from './components/ui/button';
import { commercialMoney as money, commercialDate, type RecyclingRecord } from './lib/commercial-contract';
import { adjacentRecyclingMonth, recyclingMonth } from './lib/recycling-month';
import './recycling-monthly.css';

export function RecyclingMonthly({ records, date, onAdd, onReview }: { records: RecyclingRecord[]; date: string; onAdd: (date: string) => void; onReview: (record: RecyclingRecord) => void }) {
  const [month, updateMonth] = useState(() => {
    const saved = typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('recyclingMonth');
    return saved && /^\d{4}-(0[1-9]|1[0-2])$/.test(saved) ? saved : date.slice(0, 7);
  });
  const setMonth = (value: string) => {
    updateMonth(value);
    const url = new URL(window.location.href);
    url.searchParams.set('recyclingMonth', value);
    window.history.replaceState(window.history.state, '', url);
  };
  const summary = recyclingMonth(records, month);
  const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
  return <section className="recycling-monthly" aria-label="Monthly recycling breakdown">
    <header className="section-title"><div><span className="section-kicker">Metal recycling</span><h2>{label} Runs</h2><p>All recorded runs by run or yard ticket date. Payment dates are tracked separately.</p></div><div className="recycling-month-controls">
      <Button variant="outline" size="sm" aria-label="Previous recycling month" onClick={() => setMonth(adjacentRecyclingMonth(month, -1))}>Previous</Button>
      <label>Month<input type="month" aria-label="Recycling month" value={month} onChange={event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value); }} /></label>
      <Button variant="outline" size="sm" aria-label="Next recycling month" onClick={() => setMonth(adjacentRecyclingMonth(month, 1))}>Next</Button>
      <Button size="sm" onClick={() => onAdd(date.startsWith(month) ? date : `${month}-01`)}>Add Run</Button>
    </div></header>
    <div className="finance-recovery-kpis" aria-label="Monthly recycling summary">
      <article><span>Recorded Runs</span><strong>{summary.runs.length}</strong><small>{summary.days.length} recorded days</small></article>
      <article><span>Run Value</span><strong>{money(summary.runValue)}</strong><small>Value of {label} runs</small></article>
      <article><span>Paid Run Value</span><strong>{money(summary.paidValue)}</strong><small>Paid to date for this month’s runs</small></article>
      <article><span>Open Runs</span><strong>{summary.runs.filter(run => run.status !== 'Paid').length}</strong><small>Awaiting yard or payment</small></article>
      <article><span>Payments Received</span><strong>{money(summary.receivedValue)}</strong><small>Received during {label}, including earlier runs</small></article>
    </div>
    <section className="finance-recycling-shell"><div className="section-title"><div><h3>Daily Run Breakdown</h3><p>Each daily total includes the records listed beneath it.</p></div></div>
      {summary.days.map(day => <section className="recycling-day" key={day.date} aria-label={`Recycling runs ${day.date}`}>
        <header><h4>{commercialDate(day.date)}, {day.date.slice(0, 4)}</h4><span>{day.entries.length} {day.entries.length === 1 ? 'entry' : 'entries'}</span><strong>{money(day.value)}</strong></header>
        {day.entries.map(run => <article className="recycling-run" key={run.id}>
          <div><strong>{run.material}</strong><small>{run.yard || 'Awaiting yard'} · {run.owner}</small><small>{run.quantity}</small></div>
          <div><span>Tickets</span><strong>{run.ticket || 'Awaiting ticket'}</strong><small>{/^JK\d+$/i.test(run.sourceJob) ? <a href={`/schedule?date=${run.date}&job=${encodeURIComponent(run.sourceJob)}`}>{run.sourceJob}</a> : run.sourceJob}</small></div>
          <div><span>Run value</span><strong>{money(run.status === 'Paid' ? run.realizedValue : run.expectedValue)}</strong><small>{run.status === 'Paid' ? `Paid ${run.paymentDate ? commercialDate(run.paymentDate) + ', ' + run.paymentDate.slice(0, 4) : '· payment date not recorded'}` : run.status}</small></div>
          <Button variant="outline" size="sm" onClick={() => onReview(run)}>Record / Review</Button>
        </article>)}
      </section>)}
      {!summary.runs.length && <div className="marketing-empty">No recycling runs recorded for {label}.</div>}
    </section>
    {summary.received.length > 0 && <section className="finance-recovery-ledger"><div className="section-title"><div><h3>Payments Received in {label}</h3><p>Amounts allocated to individual runs; shared receipts are not counted again.</p></div><strong>{money(summary.receivedValue)}</strong></div>
      <div className="recycling-payments">{summary.received.map(run => <article key={run.id}><span>{commercialDate(run.paymentDate!)}<small>Run / ticket date {commercialDate(run.date)}</small></span><span>{run.yard}<small>{run.paymentReference}</small></span><strong>{money(run.realizedValue)}</strong></article>)}</div>
    </section>}
    {summary.missingPaymentDates > 0 && <p role="status">{summary.missingPaymentDates} paid records have no payment date and are excluded from monthly payments received. Review those records to add the date.</p>}
    <p className="finance-payment-note">Run value and payments received are two views of the same income; do not add them together. Recorded receipts do not imply a QBO posting or bank deposit.</p>
  </section>;
}
