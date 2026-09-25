import { truckDisplayText } from '../lib/junkware-trucks';
import type { DumpExpenseSummary } from './lib/dump-expense-contract';
import { commercialMoney as money } from './lib/commercial-contract';
const clock = (value: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));

export function DumpExpenses({ data }: { data?: DumpExpenseSummary }) {
  if (!data) return null;
  const includesAssumptions = data.assumedTotal > 0;
  return <section className="finance-cost-shell" aria-label="Dump expenses" id="capital-disposal">
    <div className="section-title"><div><span className="section-kicker">{data.date} · Truck disposal costs</span><h2>Disposal costs</h2>
      <p>Minimum fee assumed on entry. A matching actual expense replaces it whenever recorded.</p></div></div>
    <div className="capital-inline-totals"><div><span>Actual</span><strong>{money(data.actualTotal)}</strong></div><div><span>Assumed</span><strong>{money(data.assumedTotal)}</strong></div><div aria-describedby={includesAssumptions ? 'disposal-assumed-note' : undefined}><span>Combined{includesAssumptions && <sup>*</sup>}</span><strong>{money(data.total)}</strong></div></div>
    {includesAssumptions && <p id="disposal-assumed-note">* Combined includes assumed costs alongside recorded actual costs.</p>}
    {!data.geofencesAvailable && <p role="status">Geofence history unavailable; visit coverage is incomplete.</p>}
    {!data.policyAvailable && <p role="status">Minimum-fee settings need attention.</p>}
    {!!data.needsReviewCount && <p role="status">Some expenses need a visit or duplicate check. Combined cost is unavailable until those matches are resolved.</p>}
    {data.missingMinimumCount > 0 && <p role="status">{data.missingMinimumCount} visit(s) need a facility minimum; combined total is incomplete.</p>}
    <div className="finance-cost-list">{data.records.map(record => <article key={record.id}>
      <div><strong>{truckDisplayText(record.truck)} · {record.location || 'Location not recorded'}</strong>
        <small>{record.status === 'actual' ? record.assumedAmount === null ? 'Actual · JunkWare' : `Actual · replaces ${money(record.assumedAmount)} minimum` : record.status === 'minimum_missing' ? 'Minimum fee needed' : 'Assumed minimum'}</small>
        <details className="capital-record-evidence"><summary>Visit & source evidence</summary><small>{record.enteredAt ? `Entered ${clock(record.enteredAt)}` : `Recorded ${clock(record.transactionAt)}`}{record.departureBounds ? ` · Left between ${clock(record.departureBounds.after)} and ${clock(record.departureBounds.by)}` : record.departedAt ? ` · Left ${clock(record.departedAt)}` : record.enteredAt ? ' · Awaiting departure evidence' : ''}</small></details>
        {record.reconciliationNote ? <small role="status">{record.reconciliationNote}</small> : record.status !== 'actual' && <small>A matching actual expense replaces this estimate whenever recorded.</small>}
      </div><strong>{record.amount === null ? 'Fee needed' : money(record.amount)}</strong><span>{record.reconciliationNote ? 'Review match' : record.status === 'actual' ? 'Actual' : 'Assumed'}</span>
    </article>)}</div>
    {!data.records.length && <p>No dump expenses or qualifying entries in the available history.</p>}
    <footer>Daily operating expenses include assumptions until a matching manual expense replaces them. JunkWare and QBO retain their source records.</footer>
  </section>;
}
