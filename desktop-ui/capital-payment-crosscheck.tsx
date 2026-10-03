import { CapitalSourceLink } from './capital-ui';
import { commercialMoney as money } from './lib/commercial-contract';
import { junkwareTransactionHref, qboTransactionHref, type PaymentIssue, type CrosscheckFilter, type Payment } from './lib/payment-crosscheck';
import './capital-payment-crosscheck.css';

export function CapitalPaymentCrosscheck({ issues, filter, selected, onFilter, onSelect, onReview, qboFresh, qboObservedAt, processorObservedAt }: {
  issues: PaymentIssue[]; filter: CrosscheckFilter; selected: string | null;
  onFilter: (filter: CrosscheckFilter) => void; onSelect: (id: string) => void; onReview: (payment: Payment) => void;
  qboFresh: boolean; qboObservedAt: string | null; processorObservedAt?: string | null;
}) {
  const visible = issues.filter(issue => filter === 'all' || issue.categories.includes(filter));
  const current = visible.find(issue => issue.id === selected) || visible[0];
  const junkware = junkwareTransactionHref(current?.appointmentId);
  const possibleJobs = current?.reasons.includes('QBO only') ? issues.filter(issue => issue.possibleQbo.some(tx => current.qbo.some(source => source.id === tx.id && source.type === tx.type))) : [];
  const observed = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Unavailable';
  return <section id="payment-crosscheck" className="capital-panel payment-crosscheck" aria-label="Cross-check payments" tabIndex={-1}>
    <header><div><span className="capital-eyebrow">NEEDS ATTENTION</span><h3>Cross-check payments</h3><p>Select an inconsistency to compare its sources and open the original transaction.</p></div><strong>{issues.length} records to review</strong></header>
    <div className="capital-toolbar"><div className="capital-filter-group" role="group" aria-label="Filter inconsistencies">{([
      ['all', 'All inconsistencies'], ['cards', 'Unverified cards'], ['accounting', 'Accounting'], ['cash', 'Cash & checks'], ['processor', 'Processor'],
    ] as const).map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => onFilter(key)}>{label} · {issues.filter(issue => key === 'all' || issue.categories.includes(key)).length}</button>)}</div></div>
    {!qboFresh && <p className="crosscheck-notice">QuickBooks evidence is stale or unavailable. Refresh data before resolving an accounting difference.</p>}
    {current ? <div className="crosscheck-layout">
      <nav aria-label="Inconsistent transactions" className="crosscheck-list">{visible.map(issue => <button key={issue.id} aria-current={current.id === issue.id ? 'true' : undefined} onClick={() => onSelect(issue.id)}>
        <span><strong>{issue.customer && issue.customer !== '—' ? issue.customer : issue.reasons.includes('QBO only') ? 'Unmatched QuickBooks transaction' : 'Customer unavailable'}</strong><b>{money(issue.recorded ?? issue.qbo[0]?.amount ?? issue.processor?.amount)}</b></span>
        <small>{issue.reference} · {issue.date}{issue.card ? ` · Card ${issue.card}` : ''}</small><span className="crosscheck-reason">{issue.reasons.join(' · ')}</span>
      </button>)}</nav>
      <article className="crosscheck-detail" aria-label="Selected inconsistency">
        <h4>{current.customer && current.customer !== '—' ? `${current.customer} · ${current.reference}` : `Transaction ${current.reference}`}</h4><p>{current.reasons.join(' · ')}</p>
        <div className="crosscheck-sources"><section><h5>JunkWare payment</h5><strong className="crosscheck-amount">{money(current.recorded)}</strong>
          {current.payment ? <><p>{current.payment.paymentMethod}{current.payment.checkNumber ? ` #${current.payment.checkNumber}` : ''}</p><p>Job {money(current.payment.revenueAmount)} · Tip {money(current.payment.tipAmount)}</p>{current.payment.jobDifference != null && <p>Job difference {money(current.payment.jobDifference)}</p>}</> : <p>{current.recorded == null ? 'No matched JunkWare payment' : `Card ${current.card || 'unavailable'}`}</p>}
          <div className="crosscheck-links">{junkware ? <CapitalSourceLink href={junkware}>Open JunkWare job</CapitalSourceLink> : <small>Direct JunkWare reference unavailable</small>}{current.payment && <><a className="capital-button" href={`/schedule?date=${current.date}&job=${encodeURIComponent(current.payment.jkNumber)}`}>Open job in OpsCenter</a><button className="capital-button" onClick={() => onReview(current.payment!)}>Review payment evidence</button></>}</div>
          {!!possibleJobs.length && <div className="crosscheck-candidates"><h5>Possible related payments</h5><p>Same date and card. Not a confirmed match.</p>{possibleJobs.map(issue => <div className="crosscheck-transaction" key={issue.id}><p>{issue.customer} · {issue.reference} · {money(issue.recorded)}</p><button className="capital-button" onClick={() => onSelect(issue.id)}>Compare payment {issue.reference}</button></div>)}</div>}
        </section><section><h5>QuickBooks</h5>
          {!current.qbo.length && <p>No matched QuickBooks transaction</p>}
          {current.reasons.includes('Ambiguous match') && <p className="crosscheck-notice">Multiple candidates — none is a confirmed match.</p>}
          {current.qbo.map((tx, index) => <div className="crosscheck-transaction" key={`${tx.id}-${index}`}><strong className="crosscheck-amount">{money(tx.amount)}</strong><p>{tx.type || 'Transaction'} {tx.id} · {tx.date || 'Date unavailable'}</p><p>{tx.cardLastFour ? `Card ${tx.cardLastFour} · ` : ''}{tx.status || 'Status unavailable'}</p>{current.recorded != null && tx.amount != null && <p>QBO − JunkWare: <strong>{money(Math.round((tx.amount - current.recorded) * 100) / 100)}</strong></p>}{qboTransactionHref(tx.id,tx.type) ? <CapitalSourceLink href={qboTransactionHref(tx.id,tx.type)!}>Open QuickBooks transaction {tx.id}</CapitalSourceLink> : <small>Direct QuickBooks link unavailable</small>}</div>)}
          {!!current.possibleQbo.length && <div className="crosscheck-candidates"><h5>Possible related transactions</h5><p>Same date and card ending {current.card}. Not a confirmed match.</p>{current.possibleQbo.map((tx,index) => <div className="crosscheck-transaction" key={`${tx.id}-${index}`}><strong className="crosscheck-amount">{money(tx.amount)}</strong><p>{tx.type} {tx.id} · {tx.date || 'Date unavailable'}</p>{current.recorded != null && tx.amount != null && <p>Amount difference: <strong>{money(Math.round((tx.amount-current.recorded)*100)/100)}</strong></p>}{qboTransactionHref(tx.id,tx.type) ? <CapitalSourceLink href={qboTransactionHref(tx.id,tx.type)!}>Open QuickBooks transaction {tx.id}</CapitalSourceLink> : <small>Direct QuickBooks link unavailable</small>}</div>)}</div>}
        </section></div>
        {(current.processor || current.payment?.processor?.transaction) && <div className="crosscheck-processor"><h5>Merchant Center</h5>{(() => { const tx = current.processor || current.payment!.processor!.transaction!; return <><p>{money(tx.amount)} · {tx.status} · {tx.transactionId}</p><CapitalSourceLink href={`https://merchantcenter.intuit.com/msc/portal/reporting#transaction/${encodeURIComponent(tx.transactionId)}`}>Open processor transaction</CapitalSourceLink></>; })()}</div>}
        <footer>QBO observed {observed(qboObservedAt)} · Processor observed {observed(processorObservedAt)}. Reviewing sources does not change payments.</footer>
      </article>
    </div> : <p className="crosscheck-notice">No {filter === 'all' ? 'inconsistencies' : 'records in this category'} in the available evidence.</p>}
  </section>;
}
