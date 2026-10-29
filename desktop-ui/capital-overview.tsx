import { SectionLayout } from './section-layout';
import { RevenuePace } from './revenue-pace';
import { MetricValue } from './metric-value';
import { DeltaChip } from './delta-chip';
import type { ReactNode } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, BarChart3, BookOpen, CheckCircle2, CircleAlert, CreditCard, Fuel, Package, Recycle, Wallet } from 'lucide-react';
import { commercialMoney as money, commercialPercent as percent, commercialDate, type FinanceData, type FinanceView } from './lib/commercial-contract';
import { verifiedPayments } from './lib/payment-verification';

import './capital-overview.css';



export function CapitalOverview({ data, date, dailySummary, sourceDetails, onViewChange }: {
  data: FinanceData; date: string; dailySummary: ReactNode; sourceDetails?: ReactNode; onViewChange: (view: FinanceView) => void;
}) {
  const period = data.trendComparisons?.[date.slice(0,7)];
  const comparison = period && period.currentEnd === data.month.through ? period : undefined;
  const displayed = {revenue:data.month.revenue,costs:data.month.costs,profit:data.month.profit,averageJob:data.month.revenue != null && data.month.jobs ? data.month.revenue/data.month.jobs : null};
  const delta = (field: 'revenue'|'costs'|'profit'|'averageJob') => <DeltaChip current={displayed[field]} comparison={comparison && displayed[field] != null && comparison.current[field] != null && Math.abs(displayed[field]! - comparison.current[field]!) < .011 ? {prior:comparison.prior[field],label:`${comparison.priorStart}–${comparison.priorEnd}`} : undefined} lowerIsBetter={field === 'costs'} />;
  const verification = verifiedPayments(data.reconciliation);
  const toList = data.resale.filter(item => !item.deletedAt && item.status === 'to_list').length;
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
  return <SectionLayout as="div" group="capital-overview-1" className="capital-hub">
    <header className="capital-period"><p><strong><MetricValue value={data.month.label} /></strong> · Month to date through {commercialDate(data.month.through)}</p><div className="capital-period-actions"><button className="capital-button" onClick={() => onViewChange('reconciliation')}>Reconcile yesterday <ArrowRight size={15} /></button><button className="capital-button" onClick={() => onViewChange('accounting')}><BookOpen size={15} /> Accounting & reports <ArrowUpRight size={14} /></button></div></header>
    <section data-layout-id="capital-metrics" className="capital-metrics" aria-label="Month-to-date financial summary">
      <button className="capital-metric capital-metric-primary" onClick={() => onViewChange('trends')}><span><Wallet size={16} /> Revenue <ArrowUpRight size={16} /></span>{delta('revenue')}<strong><MetricValue value={money(data.month.revenue)} /></strong><small>Recorded revenue</small><div className="capital-metric-footer">{data.month.jobs == null ? 'Job count unavailable' : `${data.month.jobs.toLocaleString()} completed jobs`}</div></button>
      <button className="capital-metric" onClick={() => onViewChange('expenses')}><span><ArrowDownLeft size={16} /> Operating costs <ArrowUpRight size={16} /></span>{delta('costs')}<strong className={data.month.costs == null ? 'capital-unavailable' : ''}><MetricValue value={money(data.month.costs)} /></strong><small>{data.month.costs == null ? 'Monthly cost coverage is incomplete' : `${percent(data.month.costs, data.month.revenue)} of revenue`}</small><div className="capital-metric-footer">{data.month.costs == null ? 'Needs review' : 'Payroll, disposal, fuel & other'}</div></button>
      <button className="capital-metric" onClick={() => onViewChange('trends')}><span><BarChart3 size={16} /> Operating profit <ArrowUpRight size={16} /></span>{delta('profit')}<strong className={data.month.profit == null ? 'capital-unavailable' : data.month.profit < 0 ? 'capital-negative' : 'capital-positive'}><MetricValue value={money(data.month.profit)} /></strong><small>{data.month.profit == null ? 'Waiting for complete cost inputs' : `${percent(data.month.profit, data.month.revenue)} estimated margin`}</small><div className="capital-metric-footer">Estimate · before accounting close</div></button>
      <button className="capital-metric" onClick={() => onViewChange('trends')}><span><CreditCard size={16} /> Average job <ArrowUpRight size={16} /></span>{delta('averageJob')}<strong><MetricValue value={money(data.month.jobs && data.month.revenue != null ? data.month.revenue / data.month.jobs : null)} /></strong><small>Revenue per completed job</small></button>
    </section>
    {sourceDetails}
    <SectionLayout as="div" group="capital-overview-2" data-layout-id="capital-main-grid" className="capital-main-grid">
      <RevenuePace days={data.revenuePace || []} date={date} />
      <section data-layout-id="capital-panel-2" className="capital-panel capital-attention"><header><div><span className="capital-eyebrow">YOUR NEXT ACTIONS</span><h3>Needs attention</h3></div><span className="capital-count">{attention.length}</span></header>
        {attention.length ? <div className="capital-action-list">{attention.map(item => <button key={item.title} onClick={() => onViewChange(item.target)}><span className="capital-action-count">{item.value}</span><span><strong><MetricValue value={item.title} /></strong><small>{item.detail}</small></span><ArrowRight size={15} /></button>)}</div> : <div className="capital-all-clear"><CheckCircle2 size={26} /><strong>No open items in this snapshot</strong><p>Review the source records before closing the day.</p></div>}
        <button className="capital-attention-footer" onClick={() => onViewChange('payments')}>Review payments & closeout <ArrowRight size={15} /></button>
      </section>
    </SectionLayout>
    <section data-layout-id="capital-panel" className="capital-panel capital-day"><header><div><span className="capital-eyebrow">SELECTED OPERATING DAY · {commercialDate(date)}</span><h3>The day at a glance</h3></div><span className="capital-date">{date}</span></header>{dailySummary}
      <div className="capital-payment-pulse"><CreditCard size={17} /><span><strong><MetricValue value={verification.available ? money(verification.total) : 'Unavailable'} /></strong> verified card payments <small>{verification.available ? `${verification.count} verified · ${verification.unresolvedCount} need verification` : 'Payment records unavailable'}</small></span><button className="capital-text-button" onClick={() => onViewChange('payments')}>View payments <ArrowRight size={14} /></button></div>
    </section>
    <SectionLayout as="div" group="capital-overview-3" data-layout-id="capital-secondary-grid" className="capital-secondary-grid">
      <section data-layout-id="capital-panel-3" className="capital-panel"><header><div><span className="capital-eyebrow">MONTH TO DATE</span><h3>Revenue by territory</h3></div><span className="capital-date">{data.month.label}</span></header><div className="capital-territories">{data.territories.map(item => <div className="capital-territory" key={item.territory}><div><strong><MetricValue value={item.territory.replace(/^Junk King /, '')} /></strong><span>{money(item.revenue)}</span></div><div className="capital-territory-track"><i style={{ width: `${Math.max(0, (item.revenue ?? 0) / maxTerritory * 100)}%` }} /></div><small>{item.jobs == null ? 'Job count unavailable' : `${item.jobs} completed jobs`}</small></div>)}{!data.territories.length && <p>Territory revenue is unavailable.</p>}</div><footer>Published market totals · Direct costs are not allocated by territory.</footer></section>
      <section data-layout-id="capital-panel-4" className="capital-panel"><header><div><span className="capital-eyebrow">MONTH TO DATE</span><h3>Where the money goes</h3></div><button className="capital-text-button" onClick={() => onViewChange('expenses')}>Expenses <ArrowRight size={14} /></button></header><div className="capital-costs">{data.costs.map((cost, index) => <div key={cost.category}><i className={`capital-cost-dot capital-cost-${index % 4}`} /><span><strong><MetricValue value={cost.category} /></strong><small>{cost.source}</small></span><strong><MetricValue value={money(cost.amount)} /></strong></div>)}</div><footer className="capital-cost-total"><span>Total operating costs</span><strong><MetricValue value={money(data.month.costs)} /></strong></footer></section>
    </SectionLayout>
    <section data-layout-id="capital-destinations" className="capital-destinations" aria-label="Financial workspaces">{[
      { title: 'Accounting & reports', detail: 'QuickBooks books and accountant statements', icon: BookOpen, view: 'accounting' as const },
      { title: 'Operating expenses', detail: 'Disposal, fuel cards and reconciliation', icon: Fuel, view: 'expenses' as const },
      { title: 'Resale inventory', detail: `${data.resale.filter(item => !item.deletedAt && item.status !== 'sold').length} recorded items on hand`, icon: Package, view: 'resale' as const },
      { title: 'Recycling income', detail: `${unpaidRuns} deliveries awaiting payment evidence`, icon: Recycle, view: 'recycling' as const },
    ].map(item => <button key={item.view} onClick={() => onViewChange(item.view)}><item.icon size={19} /><span><strong><MetricValue value={item.title} /></strong><small>{item.detail}</small></span><ArrowUpRight size={16} /></button>)}</section>
    <p className="capital-source-note"><CircleAlert size={14} /> Operational profit, recorded payments and accounting income have separate sources and reporting periods.</p>
  </SectionLayout>;
}
