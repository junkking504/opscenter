'use client';

import { CapitalPageHeader } from './capital-ui';
import { useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FinanceData } from './lib/commercial-contract';
import { commercialMoney as money } from './lib/commercial-contract';
import { fromFinanceMonth, type TrendValues } from '../lib/finance-trend-comparison';
import { financeChange, financePerformance, performanceExplanation, type PerformanceComparison, type PerformanceScope } from './lib/finance-performance';
import './finance-trends.css';
import { OperatingTrends } from './operating-trends';
import { monthRevenueProjection } from '../lib/operating-planning';
import { currentOperatingDay } from './lib/operating-day';

const metrics = [{ key: 'revenue', label: 'Revenue' }, { key: 'jobs', label: 'Completed jobs' }, { key: 'averageJob', label: 'Average job value' }] as const;
const format = (key: keyof TrendValues, value: number | null | undefined) => value == null ? '—' : key === 'jobs' ? value.toLocaleString('en-US') : key === 'margin' ? `${value.toFixed(1)}%` : money(value);
const dateLabel = (date?: string) => date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : 'No matching history';
const monthLabel = (key: string) => new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
function Delta({ field, current, prior }: { field: keyof TrendValues; current: number | null; prior: number | null }) {
  const change = financeChange(field, current, prior);
  if (!change) return null;
  const sign = change.difference > 0 ? '+' : change.difference < 0 ? '−' : '';
  const absolute = field === 'margin' ? `${sign}${Math.abs(change.difference).toFixed(1)} pp` : `${sign}${format(field, Math.abs(change.difference))}`;
  const percent = change.percent == null ? 'No prior baseline' : `${change.percent > 0 ? '+' : ''}${change.percent.toFixed(1)}%`;
  return <span className="finance-performance-delta">{absolute}{field === 'margin' ? '' : ` · ${percent}`}</span>;
}
export default function FinanceTrends({ data, hideCharts = false }: { data: FinanceData; hideCharts?: boolean }) {
  const section = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState({ date: data.date, month: data.date.slice(0, 7) });
  const key = selection.date === data.date ? selection.month : data.date.slice(0, 7);
  const [scope, setScope] = useState<PerformanceScope>('month');
  const [comparison, setComparison] = useState<PerformanceComparison>('prior');
  const [chartMetric, setChartMetric] = useState<'revenue' | 'jobs' | 'averageJob'>('revenue');
  const view = financePerformance(data, key, scope, comparison);
  const { current, prior } = view;
  const ordered = [...data.trends].sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  const noComparison = metrics.some(({ key: metric }) => current[metric] != null && prior[metric] == null && !(metric === 'averageJob' && prior.jobs === 0));
  const year = Number(key.slice(0, 4));
  const liveMonth = data.trends.find(month => month.monthKey === data.date.slice(0, 7));
  const projection = monthRevenueProjection(data.operatingTrends, { today: currentOperatingDay(), month: data.date.slice(0, 7), actual: liveMonth?.grossRevenue ?? null, through: liveMonth?.dataThroughDate ?? '', partialDayRevenue: data.daily.revenue, missingDates: liveMonth?.revenueSource === 'junkware-monthly-dashboard' ? [] : liveMonth?.missingDates });
  const chart = Array.from({ length: Number(key.slice(5)) }, (_, i) => {
    const monthKey = `${year}-${String(i + 1).padStart(2, '0')}`;
    const month = data.trends.find(m => m.monthKey === monthKey);
    const complete = month && (month.reportingComplete ?? month.complete);
    const previous = data.trendComparisons?.[monthKey]?.yearPrior;
    const projected = chartMetric === 'revenue' && monthKey === data.date.slice(0, 7) ? projection : null;
    const partialActual = chartMetric === 'revenue' && monthKey === data.date.slice(0, 7) && month ? month.grossRevenue : null;
    return { month: new Date(`${monthKey}-01T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' }), current: partialActual ?? (complete ? fromFinanceMonth(month)[chartMetric] : null), remaining: projected?.remaining ?? null, prior: complete ? previous?.[chartMetric] ?? null : null };
  });
  const currentMonth = key === data.date.slice(0, 7);
  const monthTitle = view.month?.reportingComplete || view.month?.complete ? 'Full month' : currentMonth ? 'Month to date' : 'Available history';
  const selectMonth = (month: string) => setSelection({ date: data.date, month });
  return <section ref={section} className="finance-performance capital-page" aria-label="Finance Trends">
    <CapitalPageHeader eyebrow="PERFORMANCE & TRENDS" title="Understand what drives growth" description="Compare revenue, job volume and profitability across reporting periods."/>
    <h3 className="finance-performance-section">Monthly performance</h3>
    <div className="finance-performance-controls">
      <label>Period<select value={scope} onChange={event => setScope(event.target.value as PerformanceScope)}><option value="month">{monthTitle}</option><option value="ytd">Year to date</option></select></label>
      <label>{scope === 'ytd' ? 'Through month' : 'Month'}<select value={key} onChange={event => selectMonth(event.target.value)}>{!view.month && <option value={key}>{monthLabel(key)} · no history</option>}{ordered.map(month => <option key={month.monthKey} value={month.monthKey}>{month.monthDisplay}</option>)}</select></label>
      <label>Compare with<select value={scope === 'ytd' ? 'year' : comparison} onChange={event => setComparison(event.target.value as PerformanceComparison)} disabled={scope === 'ytd'}><option value="prior">Previous month</option><option value="year">Same period last year</option></select></label>
    </div>
    <p className="finance-performance-period">{dateLabel(view.start)} – {dateLabel(view.end)} <span>compared with {dateLabel(view.priorStart)}{view.priorEnd ? ` – ${dateLabel(view.priorEnd)}` : ''}</span></p>
    {(noComparison || view.missingDates.length > 0 || view.missingMonths > 0) && <div className="finance-performance-notice" role="status">
      <strong>{noComparison ? 'Comparison needs more history.' : 'Daily records are incomplete.'}</strong>{' '}
      {view.missingMonths > 0 ? `${view.missingMonths} month(s) are missing; affected YTD totals are unavailable. ` : ''}
      {view.missingDates.length > 0 ? `${view.missingDates.length} daily ${view.missingDates.length === 1 ? 'record is' : 'records are'} missing in the selected period. Costs, profit and margin require complete daily coverage. ` : ''}
      {noComparison ? 'Changes appear only when both periods have matching values and coverage. See source details below.' : ''}
      {view.matchedEnd && view.matchedEnd !== view.end && !(view.month?.reportingComplete ?? view.month?.complete) ? ` The matched daily comparison ends ${dateLabel(view.matchedEnd)} because the comparison month is shorter.` : ''}
    </div>}
    <div className="finance-performance-kpis" aria-live="polite">{metrics.map(({ key: metric, label }) => <article key={metric}><span>{label}</span><strong>{format(metric, current[metric])}</strong><Delta field={metric} current={current[metric]} prior={prior[metric]} />{prior[metric] != null && <small>Previous: {format(metric, prior[metric])}</small>}</article>)}</div>
    <section className="finance-performance-section"><h3>What changed</h3><p className="finance-performance-explanation">{performanceExplanation(current, prior)}</p></section>
    <section className="finance-performance-section">
      <div className="finance-performance-chart-heading"><div><h3>Performance over time</h3><p>{chartMetric === 'revenue' ? 'Completed months plus current-month revenue actuals and prediction.' : 'Full months only.'} Gaps mean unavailable data.</p></div><label>Chart metric<select value={chartMetric} onChange={event => setChartMetric(event.target.value as typeof chartMetric)}>{metrics.map(metric => <option key={metric.key} value={metric.key}>{metric.label}</option>)}</select></label></div>
      <div className="finance-performance-legend"><span><i style={{ background: 'var(--capital-gold-soft, #fff1cf)' }} />{year - 1}</span><span><i style={{ background: 'var(--capital-gold, #e3aa32)' }} />{year} actual</span>{chartMetric === 'revenue' && projection && key === data.date.slice(0, 7) && <span><i style={{ background: '#bc7c1440', border: '1px dashed #bc7c14' }} />Predicted remaining revenue</span>}</div>
      <div className="finance-performance-chart" role="img" aria-label={`${metrics.find(m => m.key === chartMetric)?.label} by month, ${year - 1} on the left and ${year} on the right${chartMetric === 'revenue' && projection && key === data.date.slice(0, 7) ? '; shaded segment above current actual revenue is predicted remaining revenue' : ''}.`}>
        <ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{ top: 12, right: 4, bottom: 0, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="month" tickLine={false} axisLine={false} minTickGap={15} /><YAxis width={62} tickLine={false} axisLine={false} tickFormatter={value => chartMetric === 'jobs' ? String(value) : Math.abs(value) >= 1000 ? `$${value / 1000}k` : `$${value}`} /><Tooltip cursor={false} formatter={value => format(chartMetric, typeof value === 'number' ? value : null)} contentStyle={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 8 }} />
          <Bar name={String(year - 1)} dataKey="prior" stackId="prior" fill="var(--capital-gold-soft, #fff1cf)" radius={[3, 3, 0, 0]} isAnimationActive={false} /><Bar name={`${year} actual`} dataKey="current" stackId="current" fill="var(--capital-gold, #e3aa32)" isAnimationActive={false} /><Bar name="Predicted remaining revenue" dataKey="remaining" stackId="current" fill="#bc7c14" fillOpacity={.25} stroke="#bc7c14" strokeDasharray="4 3" isAnimationActive={false} />
        </BarChart></ResponsiveContainer>
      </div>
      {chartMetric === 'revenue' && key === data.date.slice(0, 7) && (projection ? <div className="finance-performance-notice"><strong>Projected month-end revenue: {money(projection.total)}</strong><p>{money(projection.actual)} recorded through {dateLabel(projection.through)} + {money(projection.remaining)} predicted remaining. The shaded segment is additional revenue, not the total prediction.</p><p>Low-confidence estimate assuming daily operation including Sundays. Backtest error: {projection.backtest.wape == null ? 'unavailable' : `${(projection.backtest.wape * 100).toFixed(1)}% WAPE`} ({projection.backtest.samples} tests). No calibrated prediction interval.{projection.lowSampleDays ? ` ${projection.lowSampleDays} forecast day(s) use sparse or fallback history.` : ''}{projection.missingDates.length ? ` Actuals have ${projection.missingDates.length} missing historical day(s); the total may understate revenue. Missing days are not filled as actuals.` : ''}</p><details><summary>See revenue prediction data</summary><p>Same recency-weighted operating-weekday method as Demand planning. Today's already-recorded revenue is subtracted from today's estimate; actuals are never reduced.</p><div className="operating-data-table"><table><thead><tr><th>Date</th><th>Additional revenue</th><th>Training days</th><th>Method</th></tr></thead><tbody>{projection.estimates.map(row => <tr key={row.date}><td>{row.date}</td><td>{money(row.value)}</td><td>{row.samples}</td><td>{row.method}</td></tr>)}</tbody></table></div></details></div> : <p>Month-end revenue prediction needs current, dated actuals and enough operating history.</p>)}
    </section>
    <section className="finance-performance-section"><h3>Costs & profitability <small>Operating estimates</small></h3><p>Published daily records. Margin uses daily sales, the revenue basis behind the operating profit estimate. These are not QuickBooks financial statements.</p>
      <div className="finance-performance-kpis finance-performance-operating">{([{ key: 'costs', label: 'Recorded operating costs' }, { key: 'profit', label: 'Estimated operating profit' }, { key: 'margin', label: 'Margin on daily sales' }] as const).map(({ key: metric, label }) => <article key={metric}><span>{label}</span><strong>{format(metric, current[metric])}</strong><Delta field={metric} current={current[metric]} prior={prior[metric]} /></article>)}</div>
      {view.revenueDifference != null && Math.abs(view.revenueDifference) >= .01 && <div className="finance-performance-notice"><strong>Revenue sources differ by {money(Math.abs(view.revenueDifference))}.</strong> Headline revenue is {view.revenueDifference > 0 ? 'higher' : 'lower'} than daily sales. The difference is not included in the daily operating profit estimate.</div>}
      {view.operatingRevenue != null && <div className="finance-performance-basis"><span>Daily sales <strong>{money(view.operatingRevenue)}</strong></span>{view.recyclingIncome != null && <span>Recycling income <strong>{money(view.recyclingIncome)}</strong></span>}<span>Recorded costs <strong>{format('costs', current.costs)}</strong></span><span>Published profit <strong>{format('profit', current.profit)}</strong></span></div>}
    </section>
    <details className="finance-performance-section finance-performance-details"><summary>Monthly history</summary><p>Newest first. Select a month to update the performance view.</p><div className="finance-performance-table"><table><thead><tr><th>Month</th>{metrics.map(metric => <th key={metric.key}>{metric.label}</th>)}<th>Daily coverage</th></tr></thead><tbody>{ordered.map(month => <tr key={month.monthKey} aria-current={month.monthKey === key ? 'true' : undefined}><td><button onClick={() => { selectMonth(month.monthKey); setScope('month'); section.current?.scrollIntoView({ block: 'start' }); }}>{month.monthDisplay}</button><small>{month.reportingComplete || month.complete ? 'Full-month revenue' : `Through ${dateLabel(month.dataThroughDate)}`}</small></td><td>{money(month.grossRevenue)}</td><td>{month.completedJobs.toLocaleString('en-US')}</td><td>{format('averageJob', fromFinanceMonth(month).averageJob)}</td><td>{month.missingDates?.length ? `${month.missingDates.length} missing ${month.missingDates.length === 1 ? 'day' : 'days'}` : 'Available'}</td></tr>)}</tbody></table></div></details>
    <details className="finance-performance-section finance-performance-details"><summary>Source details & coverage</summary><p>Revenue and completed jobs use verified JunkWare monthly totals when available, otherwise published daily metrics. Partial-month comparisons require every daily record in the matching date range. Missing dates are not treated as zero.</p><p>YTD adds every month from January through the chosen month. Average job value is total revenue divided by total jobs. Margin is total published operating profit divided by total daily sales. A source difference is preserved for reconciliation.</p>
      {view.months.map((month, i) => month ? <div className="finance-performance-source" key={month.monthKey}><strong>{month.monthDisplay}</strong><span>{month.revenueSource === 'junkware-monthly-dashboard' ? 'JunkWare monthly dashboard' : 'Published daily metrics'}</span><small>Daily records through {dateLabel(month.dataThroughDate)}{month.missingDates?.length ? ` · Missing: ${month.missingDates.join(', ')}` : ' · No missing dates'}</small></div> : <p key={i}>Missing month: {monthLabel(`${year}-${String(i + 1).padStart(2, '0')}`)}</p>)}
      <p>Comparison coverage: {metrics.map(metric => `${metric.label}: ${prior[metric.key] == null ? 'unavailable' : 'available'}`).join(' · ')}</p>
    </details>
    {!data.trends.length && <p>No published monthly history is available.</p>}
    {!hideCharts && <OperatingTrends data={data.operatingTrends} scope="business" />}
  </section>;
}
