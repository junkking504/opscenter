import { commercialMoney as money } from './lib/commercial-contract';
import type { MerchantEvidence, MerchantReport } from './lib/merchant-evidence-contract';
export const merchantLink = (id: string) => `https://merchantcenter.intuit.com/msc/portal/reporting#transaction/${encodeURIComponent(id)}`;
export function MerchantPaymentEvidence({ evidence }: { evidence?: MerchantEvidence }) {
  if (!evidence || evidence.state === 'unavailable') return <small>Merchant Center: not verified</small>;
  if (evidence.state === 'ambiguous') return <small>Merchant Center: ambiguous match</small>;
  if (evidence.state === 'not_found') return <small>Not found in Merchant Center export{!evidence.fresh ? ' · refresh needed' : ''}</small>;
  const t = evidence.transaction;
  return <small>Merchant Center: {evidence.state === 'approved' ? 'Approved' : t?.status || 'Review required'}{!evidence.fresh ? ' · historical evidence; refresh needed' : ''}</small>;
}
export function MerchantReportSummary({ report }: { report?: MerchantReport }) {
  return <section aria-label="Merchant Center processing evidence" className="finance-recovery-ledger">
    <div className="section-title"><div><span className="section-kicker">JunkWare job payment → Merchant Center processing → QBO accounting</span><h2>Merchant Center</h2>
      <p>{report?.available ? `${report.complete ? 'Full day export' : 'Partial transaction evidence'} · Observed ${new Date(report.collectedAt!).toLocaleString()}${report.fresh ? '' : ' · Refresh needed'}` : report?.issue || 'Merchant Center has not been collected for this date.'}</p></div>
      <a href="https://merchantcenter.intuit.com/msc/portal/reporting">Open Merchant Center</a></div>
    {report?.available && report.issue && <p role="status">{report.issue}</p>}
    <div className="finance-recovery-ledger-summary"><article><span>{report?.complete ? 'Approved card sales' : 'Approved sales observed · partial'}</span><strong>{money(report?.approvedTotal ?? null)}</strong><small>{report?.available ? `${report.approvedCount} approved transactions` : 'Unavailable'}</small></article>
      <article><span>Evidence coverage</span><strong>{!report?.available ? 'Not collected' : report.complete ? 'Full day' : 'Partial'}</strong><small>QBO totals above remain separate</small></article>
      <article><span>Processor records needing a job match</span><strong>{report?.available ? report.unmatched.length : '—'}</strong><small>Review source references below</small></article></div>
    {!!report?.unmatched.length && <div className="finance-close-list">{report.unmatched.map(({transaction:t,qboTransactionId,reason}) => <article key={t.transactionId}><div><strong>{t.customer || t.jkNumber || 'Customer unavailable'}</strong><small>{reason}</small></div><span>{money(t.amount)} · card {t.cardLastFour || 'unavailable'} · {t.status}</span><div><a href={merchantLink(t.transactionId)}>Merchant {t.transactionId}</a><small>QBO {qboTransactionId || 'not matched'}</small></div></article>)}</div>}
    <footer>Processor approval does not establish a bank deposit or a QBO posting. Missing or stale Merchant Center evidence stays visible; it never clears an accounting exception.</footer>
  </section>;
}
