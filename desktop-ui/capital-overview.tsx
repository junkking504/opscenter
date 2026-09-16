import type { ReactNode } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, BarChart3, BookOpen, CheckCircle2, CircleAlert, CreditCard, Fuel, Package, Recycle, Wallet } from 'lucide-react';
import { commercialMoney as money, commercialPercent as percent, commercialDate, type FinanceData, type FinanceView } from './lib/commercial-contract';
import { verifiedPayments } from './lib/payment-verification';
import { capitalRevenueHistory } from './lib/capital-overview';
import './capital-overview.css';

const compactMoney = new Intl.NumberFormat('en-US', { notation: 'compact', style: 'currency', currency: 'USD', maximumFractionDigits: 1 });

export function CapitalOverview({ data, date, dailySummary, onViewChange }: {
  data: FinanceData; date: string; dailySummary: ReactNode; onViewChange: (view: FinanceView) => void;
}) {
  const verification = verifiedPayments(data.reconciliation);
  const history = capitalRevenueHistory(data.trends, date);
  const chartMax = Math.max(1, ...history.map(month => month.revenue ?? 0));
  const toList = data.resale.filter(item => item.status === 'to_list').length;
  const unpaidRuns = data.recycling.filter(item => item.date <= date && item.status !== 'Paid').length;
  const missing = data.month.missingDates.length;
  const openPayments = verification.available ? verification.unresolvedCount : null;
  const attention = [
    ...(openPayments === null ? [{ title: 'Payment source unavailable', detail: 'Open payments to inspect source coverage.', value: '—', target: 'payments' as const }] : openPayments > 0 ? [{ title: 'Verify card payments', detail: `${money(Math.abs(verification.difference ?? 0))} awaiting verification`, value: String(openPayments), target: 'payments' as const }] : []),
    ...(missing || data.month.costs == null ? [{ title: 'Complete monthly cost coverage', detail: missing ? `${missing} missing date${missing === 1 ? '' : 's'} · profit is unavailable` : 'Cost inputs are incomplete or stale.', value: missing ? String(missing) : '!', target: 'trends' as const }] : []),
    ...(unpaidRuns ? [{ title: 'Review recycling payouts', detail: 'Recorded deliveries awaiting payment evidence', value: String(unpaidRuns), target: 'recycling' as const }] : []),
    ...(toList ? [{ title: 'List resale inventory', detail: 'Items ready for a listing decision', value: String(toList), target: 'resale' as const }] : []),
  ];
  const maxTerritory = Math.max(1, ...data.territories.map(item => item.revenue ?? 0));
  return <div className="capital-hub">
    <header className="capital-period"><div><span className="capital-eyebrow">BUSINESS PERFORMANCE</span><h2>Your financial picture</h2><p>{data.month.label} · Month to date through {commercialDate(data.month.through)}</p></div><button className="capital-button" onClick={() => onViewChange('accounting')}><BookOpen size={15} /> Accounting & reports <ArrowUpRight size={14} /></button></header>
    <section className="capital-metrics" aria-label="Month-to-date financial summary">
      <button className="capital-metric capital-metric-primary" onClick={() => onViewChange('trends')}><span><Wallet size={16} /> Revenue <ArrowUpRight size={16} /></span><strong>{money(data.month.revenue)}</strong><small>Published JunkWare revenue</small><div className="capital-metric-footer">{data.month.jobs == null ? 'Job count unavailable' : `${data.month.jobs.toLocaleString()} completed jobs`}<span>Month to date</span></div></button>
      <button className="capital-metric" onClick={() => onViewChange('expenses')}><span><ArrowDownLeft size={16} /> Operating costs <ArrowUpRight size={16} /></span><strong className={data.month.costs == null ? 'capital-unavailable' : ''}>{money(data.month.costs)}</strong><small>{data.month.costs == null ? 'Monthly cost coverage is incomplete' : `${percent(data.month.costs, data.month.revenue)} of revenue`}</small><div className="capital-metric-footer">Payroll, disposal, fuel & other<span>{data.month.costs == null ? 'Needs review' : 'Published costs'}</span></div></button>
      <button className="capital-metric" onClick={() => onViewChange('trends')}><span><BarChart3 size={16} /> Operating profit <ArrowUpRight size={16} /></span><strong className={data.month.profit == null ? 'capital-unavailable' : data.month.profit < 0 ? 'capital-negative' : 'capital-positive'}>{money(data.month.profit)}</strong><small>{data.month.profit == null ? 'Waiting for complete cost inputs' : `${percent(data.month.profit, data.month.revenue)} estimated margin`}</small><div className="capital-metric-footer">Operational estimate<span>Before accounting close</span></div></button>
      <button className="capital-metric" onClick={() => onViewChange('trends')}><span><CreditCard size={16} /> Average job <ArrowUpRight size={16} /></span><strong>{money(data.month.jobs && data.month.revenue != null ? data.month.revenue / data.month.jobs : null)}</strong><small>Revenue per completed job</small><div className="capital-metric-footer">Across all territories<span>Month to date</span></div></button>
    </section>
    <div className="capital-main-grid">
      <section className="capital-panel capital-performance"><header><div><span className="capital-eyebrow">REVENUE HISTORY</span><h3>See the bigger picture</h3></div><button className="capital-text-button" onClick={() => onViewChange('trends')}>Explore trends <ArrowRight size={14} /></button></header>
        <div className="capital-chart-legend"><span><i /> Reported revenue</span><span><i className="partial" /> Partial month</span><span>USD · last 6 months</span></div>
        <div className="capital-chart" role="img" aria-label={history.map(month => `${month.label}: ${money(month.revenue)}${month.partial ? ', partial month' : ''}`).join('; ')}>
          <div className="capital-chart-scale"><span>{money(chartMax)}</span><span>{money(chartMax / 2)}</span><span>$0</span></div>
          <div className="capital-chart-bars">{history.map(month => <div className="capital-chart-column" key={month.key}><span className="capital-chart-value">{month.revenue == null ? '—' : compactMoney.format(month.revenue)}</span><div className="capital-chart-track"><div className={`capital-chart-bar${month.partial ? ' partial' : ''}${month.revenue == null ? ' missing' : ''}`} style={{ height: month.revenue == null ? '100%' : `${Math.max(month.revenue > 0 ? 1 : 0, month.revenue / chartMax * 100)}%` }} /></div><span className="capital-chart-label">{month.label}{month.partial && <small>MTD</small>}</span></div>)}</div>
        </div><footer>Published monthly revenue. Partial months are marked; missing values stay unavailable.</footer>
      </section>
      <section className="capital-panel capital-attention"><header><div><span className="capital-eyebrow">YOUR NEXT ACTIONS</span><h3>Needs attention</h3></div><span className="capital-count">{attention.length}</span></header>
        {attention.length ? <div className="capital-action-list">{attention.map(item => <button key={item.title} onClick={() => onViewChange(item.target)}><span className="capital-action-count">{item.value}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowRight size={15} /></button>)}</div> : <div className="capital-all-clear"><CheckCircle2 size={26} /><strong>No open items in this snapshot</strong><p>Review the source records before closing the day.</p></div>}
        <button className="capital-attention-footer" onClick={() => onViewChange('payments')}>Review payments & closeout <ArrowRight size={15} /></button>
      </section>
    </div>
    <section className="capital-panel capital-day"><header><div><span className="capital-eyebrow">SELECTED OPERATING DAY · {commercialDate(date)}</span><h3>The day at a glance</h3></div><span className="capital-date">{date}</span></header>{dailySummary}
      <div className="capital-payment-pulse"><CreditCard size={17} /><span><strong>{verification.available ? money(verification.total) : 'Unavailable'}</strong> verified card payments <small>{verification.available ? `${verification.count} verified · ${verification.unresolvedCount} need verification` : 'Payment records unavailable'}</small></span><button className="capital-text-button" onClick={() => onViewChange('payments')}>View payments <ArrowRight size={14} /></button></div>
    </section>
    <div className="capital-secondary-grid">
      <section className="capital-panel"><header><div><span className="capital-eyebrow">MONTH TO DATE</span><h3>Revenue by territory</h3></div><span className="capital-date">{data.month.label}</span></header><div className="capital-territories">{data.territories.map(item => <div className="capital-territory" key={item.territory}><div><strong>{item.territory.replace(/^Junk King /, '')}</strong><span>{money(item.revenue)}</span></div><div className="capital-territory-track"><i style={{ width: `${Math.max(0, (item.revenue ?? 0) / maxTerritory * 100)}%` }} /></div><small>{item.jobs == null ? 'Job count unavailable' : `${item.jobs} completed jobs`}</small></div>)}{!data.territories.length && <p>Territory revenue is unavailable.</p>}</div><footer>Published market totals · Direct costs are not allocated by territory.</footer></section>
      <section className="capital-panel"><header><div><span className="capital-eyebrow">MONTH TO DATE</span><h3>Where the money goes</h3></div><button className="capital-text-button" onClick={() => onViewChange('expenses')}>Expenses <ArrowRight size={14} /></button></header><div className="capital-costs">{data.costs.map((cost, index) => <div key={cost.category}><i className={`capital-cost-dot capital-cost-${index % 4}`} /><span><strong>{cost.category}</strong><small>{cost.source}</small></span><strong>{money(cost.amount)}</strong></div>)}</div><footer className="capital-cost-total"><span>Total operating costs</span><strong>{money(data.month.costs)}</strong></footer></section>
    </div>
    <section className="capital-destinations" aria-label="Financial workspaces">{[
      { title: 'Accounting & reports', detail: 'QuickBooks books and accountant statements', icon: BookOpen, view: 'accounting' as const },
      { title: 'Operating expenses', detail: 'Disposal, fuel cards and reconciliation', icon: Fuel, view: 'expenses' as const },
      { title: 'Resale inventory', detail: `${data.resale.filter(item => item.status !== 'sold').length} recorded items on hand`, icon: Package, view: 'resale' as const },
      { title: 'Recycling income', detail: `${unpaidRuns} deliveries awaiting payment evidence`, icon: Recycle, view: 'recycling' as const },
    ].map(item => <button key={item.view} onClick={() => onViewChange(item.view)}><item.icon size={19} /><span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowUpRight size={16} /></button>)}</section>
    <p className="capital-source-note"><CircleAlert size={14} /> Operational profit, recorded payments and accounting income have separate sources and reporting periods.</p>
  </div>;
}
