import { useState } from 'react';
import { Banknote, CheckCircle2, CircleAlert, CreditCard, Search } from 'lucide-react';
import { CapitalPageHeader, CapitalStat, CapitalEmpty, CapitalSourceLink } from './capital-ui';
import { commercialMoney as money, commercialDate, type FinanceData } from './lib/commercial-contract';
import { paymentVerification, verifiedPayments } from './lib/payment-verification';
import { MerchantPaymentEvidence, MerchantReportSummary } from './merchant-evidence';

type Payment = FinanceData['reconciliation']['paymentsByJob'][number];
export function CapitalPayments({ data, date, onReview }: { data: FinanceData; date: string; onReview: (payment: Payment) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'review' | 'cash'>('all');
  const recon = data.reconciliation, verification = verifiedPayments(recon);
  const collected = recon.status !== 'not_collected';
  const qboUsable = collected && verification.qboUsable;
  const rows = recon.paymentsByJob.filter(row => {
    const matches = !query.trim() || [row.jkNumber, row.customer, row.truck, row.paymentMethod, row.checkNumber, row.qboTransactionId].join(' ').toLowerCase().includes(query.trim().toLowerCase());
    return matches && (filter === 'all' || (filter === 'review' ? paymentVerification(row, verification.qboUsable) === 'Needs verification' : row.tender === 'cash' || row.tender === 'check'));
  });
  return <div className="capital-page capital-payments">
    <CapitalPageHeader eyebrow={`PAYMENTS & COLLECTIONS · ${commercialDate(date)}`} title="Every payment, accounted for" description="Follow job payments from the recorded tender to card verification and accounting." action={<CapitalSourceLink href="https://qbo.intuit.com/">Open QuickBooks</CapitalSourceLink>}/>
    <section className="capital-stat-grid" aria-label="Payment summary">
      <CapitalStat primary icon={Banknote} label="Recorded payments" value={money(recon.recordedPayments?.total ?? (collected ? recon.summary.junkware_total : null))} detail="Card, cash and checks · JunkWare"/>
      <CapitalStat icon={CheckCircle2} label="Verified cards" value={money(verification.available ? verification.total : null)} detail={`${verification.count} verified · QBO or Merchant Center`}/>
      <CapitalStat icon={CreditCard} label="Cash & checks" value={money(recon.recordedPayments ? recon.recordedPayments.cash + recon.recordedPayments.check : null)} detail={`Cash ${money(recon.recordedPayments?.cash)} · Checks ${money(recon.recordedPayments?.check)}`}/>
      <CapitalStat warning={verification.unresolvedCount > 0} icon={CircleAlert} label="Unverified difference" value={money(verification.difference)} detail={verification.available ? `${verification.unresolvedCount} ${verification.unresolvedCount === 1 ? 'payment needs' : 'payments need'} verification` : 'Payment source unavailable'}/>
    </section>
    <section className="capital-panel capital-payment-register" aria-label="Payments by job">
      <header><div><span className="capital-eyebrow">PAYMENT REGISTER</span><h3>Payments by job</h3></div><span className="capital-date">{rows.length} of {recon.paymentsByJob.length} records</span></header>
      <div className="capital-toolbar"><div className="capital-filter-group" role="group" aria-label="Filter payments">{([['all','All payments'],['review','Needs verification'],['cash','Cash & checks']] as const).map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div><label className="capital-search"><Search size={15}/><input aria-label="Search payments" placeholder="Search job, customer or reference" value={query} onChange={event=>setQuery(event.target.value)}/></label></div>
      {rows.length ? <div className="capital-table-scroll"><table className="capital-table capital-payment-table"><thead><tr><th>Job / customer</th><th>Truck</th><th>Job total</th><th>Payment</th><th>Method / reference</th><th>Verification</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((row,index)=><tr key={`${row.jkNumber}:${row.qboTransactionId}:${index}`} className={paymentVerification(row,verification.qboUsable)==='Needs verification'?'needs-review':''}>
        <td data-label="Job / customer"><strong>{row.customer || 'Customer unavailable'}</strong>{row.jkNumber ? <a href={`/schedule?date=${date}&job=${encodeURIComponent(row.jkNumber)}`}>{row.jkNumber}</a> : <small>Job unspecified</small>}</td>
        <td data-label="Truck">{row.truck || 'Unavailable'}</td>
        <td data-label="Job total"><strong>{money(row.revenueAmount)}</strong><small>Tips {money(row.tipAmount)}</small></td>
        <td data-label="Payment"><strong>{money(row.paidAmount)}</strong><small>Difference {money(row.jobDifference === undefined ? row.revenueAmount != null && row.tipAmount != null ? row.paidAmount-row.revenueAmount-row.tipAmount : null : row.jobDifference)}</small></td>
        <td data-label="Method / reference"><strong>{row.paymentMethod}</strong><small>{row.tender==='check' ? row.checkNumber ? `Check #${row.checkNumber}` : 'Check number unavailable' : row.tender==='cash' ? 'Recorded in JunkWare' : row.qboTransactionId || 'No QBO reference'}</small><small>{row.tender !== 'cash' && row.tender !== 'check' ? row.qboStatus || 'QBO status unavailable' : ''}</small></td>
        <td data-label="Verification"><span className={`capital-status ${paymentVerification(row,verification.qboUsable)==='Needs verification'?'warning':''}`}>{paymentVerification(row,verification.qboUsable)}</span>{row.tender!=='cash' && row.tender!=='check' && <MerchantPaymentEvidence evidence={row.processor}/>}</td>
        <td><button className="capital-button" onClick={()=>onReview(row)} aria-label={`Review sources for ${row.jkNumber || row.customer}`}>Review sources</button></td>
      </tr>)}</tbody></table></div> : <CapitalEmpty icon={CreditCard} title={collected ? query || filter!=='all' ? 'No matching payments' : 'No payments in this snapshot' : 'Payment source unavailable'} description={query || filter!=='all' ? 'Try another search or return to all payments.' : 'Recorded job payments will appear here after source collection.'} action={(query || filter!=='all') && <button className="capital-button" onClick={()=>{setQuery('');setFilter('all');}}>Clear filters</button>}/>}
      <footer>Recorded payments, processor approvals and accounting postings remain separate. Source review does not post an adjustment.</footer>
    </section>
    <div className="capital-evidence-grid">
      <section className="finance-recovery-ledger" aria-label="QBO accounting comparison"><div className="section-title"><div><span className="section-kicker">ACCOUNTING EVIDENCE</span><h2>QuickBooks posting</h2><p>A posting difference does not undo a verified card payment.</p></div></div><div className="finance-recovery-ledger-summary"><article><span>Card payments in QBO</span><strong>{money(qboUsable ? recon.summary.merchant_center_total : null)}</strong></article><article><span>Posting difference</span><strong>{money(qboUsable ? recon.summary.net_difference : null)}</strong><small>{recon.summary.exception_count} accounting exceptions</small></article></div>{!!recon.exceptions.length && <div className="capital-exception-rows">{recon.exceptions.map((item,index)=><article key={`${item.reference}:${index}`}><div><strong>{item.type} · {item.reference}</strong><small>{item.customer}</small></div><span>JunkWare {money(item.junkwareAmount)}<small>QBO {money(item.merchantAmount)}</small></span></article>)}</div>}<footer>Source observed {commercialDate(recon.generatedAt || '')}</footer></section>
      <MerchantReportSummary report={recon.processor}/>
    </div>
  </div>;
}
