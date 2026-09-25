'use client';

import { useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { operatingChartRows, smoothOperatingChartRows, scopeOperatingTrends, scopeMetrics, type AnalyticsScope, type OperatingMetric, type OperatingTrendsData } from '../lib/operating-trends';
import { OperatingPlanning } from './operating-planning';
import './operating-trends.css';

const metrics: Array<{ key: OperatingMetric; title: string; unit: 'usd' | 'count' | 'gallons' | 'price' | 'miles' | 'stars'; source: string; note: string }> = [
  { key: 'fuelCost', title: 'Fuel spending', unit: 'usd', source: 'WEX posted net cost', note: 'JunkWare and WEX are separate records, not additive.' },
  { key: 'fuelGallons', title: 'Fuel purchased', unit: 'gallons', source: 'WEX gallons', note: 'Purchases, not fuel consumed. Missing/no-purchase days are not confirmed zeros.' },
  { key: 'netPerGallon', title: 'WEX net cost per gallon', unit: 'price', source: 'WEX net cost ÷ gallons', note: 'Daily total net cost divided by total gallons, not an average of pump prices. Includes any non-fuel costs or adjustments in net cost.' },
  { key: 'dumpCost', title: 'Dump expenses', unit: 'usd', source: 'JunkWare recorded dumps', note: 'Recorded disposal costs only. Unrecorded visits and assumed dump expenses are excluded.' },
  { key: 'revenue', title: 'Daily revenue', unit: 'usd', source: 'JunkWare daily revenue', note: 'Published daily sales; may differ from verified monthly totals and QuickBooks statements.' },
  { key: 'completedJobs', title: 'Completed jobs', unit: 'count', source: 'JunkWare completed jobs', note: 'Published daily completed-job count. Fractional baseline values represent expected volume, not booked jobs.' },
  { key: 'averageJob', title: 'Average job value', unit: 'usd', source: 'Daily revenue ÷ completed jobs', note: 'Uses the same daily revenue and completed-job count. Unavailable when no completed jobs are recorded.' },
  { key: 'operatingProfit', title: 'Net after recorded costs', unit: 'usd', source: 'Published net less supplemental WEX', note: 'Same recorded-cost basis as Command Net, including WEX only when published fuel is missing/zero. Historical assumed dump costs are not reconstructed. Not QuickBooks net income.' },
  { key: 'adCost', title: 'Advertising spend', unit: 'usd', source: 'SearchKings paid media cost', note: 'Daily cost reported by SearchKings; gaps mean no imported daily observation.' },
  { key: 'calls', title: 'Tracked calls', unit: 'count', source: 'SearchKings calls', note: 'Call records deduplicated by source ID. Calls are not necessarily unique leads or booked jobs.' },
  { key: 'conversions', title: 'Reported conversions', unit: 'count', source: 'SearchKings conversions', note: 'Provider-reported advertising conversions, not verified completed jobs or acquired customers.' },
  { key: 'costPerCall', title: 'Ad cost per tracked call', unit: 'usd', source: 'Daily ad cost ÷ tracked calls', note: 'A call-cost proxy, not customer acquisition cost. Cost and call totals use their reported daily scopes; not all tracked calls are paid-ad attributed.' },
  { key: 'reviews', title: 'Review volume', unit: 'count', source: 'Podium captured reviews', note: 'Counts captured reviews by creation date. Latest 100 per location in each snapshot; older history may be incomplete.' },
  { key: 'averageRating', title: 'Review rating', unit: 'stars', source: 'Daily captured rating average', note: 'Rating sum divided by captured reviews that day. Not the all-time Google rating.' },
  { key: 'miles', title: 'Distance traveled', unit: 'miles', source: 'LinxUp daily miles', note: 'Recorded distance from daily fleet metrics. No MPG is inferred from purchases; fill-to-fill consumption evidence is unavailable.' },
  { key: 'scheduledAppointments', title: 'Scheduled jobs & estimates', unit: 'count', source: 'JunkWare active schedule', note: 'Matches the Today’s jobs card: all scheduled appointments including estimates, excluding cancellations. Completed jobs remain a separate measure.' },
  { key: 'labor', title: 'Daily labor cost', unit: 'usd', source: 'JunkWare published payroll', note: 'The published daily payroll total used by the Command Labor card, not hours alone. Open crew records below to inspect individual pay.' },
  { key: 'dumpAndFuel', title: 'Dump + fuel expenses', unit: 'usd', source: 'Recorded dumps + selected fuel', note: 'Same fuel precedence as Command: published fuel, with posted WEX filling missing/zero fuel. Historical assumed dump costs are not reconstructed; today’s card can include them.' },
];
const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const day = (value: string) => dateFormat.format(new Date(`${value}T12:00:00Z`));
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
function amount(value: number | null, unit: typeof metrics[number]['unit']): string {
  if (value === null) return '—';
  return unit === 'usd' || unit === 'price' ? money.format(value) : `${number.format(value)}${unit === 'gallons' ? ' gal' : unit === 'miles' ? ' mi' : unit === 'stars' ? ' / 5' : ''}`;
}
function OperatingChart({ data, metric, days, smooth, operatingDays }: { data: OperatingTrendsData; metric: typeof metrics[number]; days: number; smooth: boolean; operatingDays: boolean }) {
  const rawRows = operatingChartRows(data, metric.key, days);
  const averaged = smooth ? smoothOperatingChartRows(data, metric.key, rawRows, operatingDays) : [];
  const rows = (smooth ? averaged : rawRows).map(row => ({ ...row, timestamp: Date.parse(`${row.date}T12:00:00Z`) }));
  const seriesName = smooth ? `7-${operatingDays ? 'operating-' : ''}day average` : metric.source;
  const model = data.forecasts.find(item => item.target === metric.key);
  const forecast = rows.filter(row => row.forecast !== null);
  const latest = rows.findLast(row => row.actual !== null);
  const hasHistory = rows.some(row => row.actual !== null || row.secondary !== null);
  const ticks = [...new Set([rawRows[0]?.date, rawRows[Math.floor((rawRows.length - 1) / 2)]?.date, rawRows.at(-1)?.date].filter((value): value is string => Boolean(value)))].map(date => Date.parse(`${date}T12:00:00Z`));
  const confidence = model?.points.some(point => point.confidence === 'low') ? 'Low' : 'Medium';
  return <article className="operating-chart" aria-labelledby={`operating-${metric.key}`}>
    <div className="operating-chart-heading"><h4 id={`operating-${metric.key}`}>{metric.title}</h4><span>{metric.unit === 'gallons' ? 'Gallons / day' : metric.unit === 'count' ? 'Count / day' : metric.unit === 'price' ? '$ / gallon' : metric.unit === 'stars' ? 'Stars / 5' : metric.unit === 'miles' ? 'Miles / day' : metric.key === 'averageJob' ? '$ / job' : metric.key === 'costPerCall' ? '$ / call' : '$ / day'}</span></div>
    <div className="operating-chart-legend"><span><i />{seriesName}</span>{metric.key === 'fuelCost' && <span><i className="secondary" />JunkWare recorded fuel{smooth ? ' · average' : ''}</span>}{forecast.length > 0 && <><span><i className="forecast" />Baseline forecast</span><span><i className="spread" />Historical spread</span></>}</div>
    {!hasHistory && !forecast.length ? <p className="operating-empty">No recorded data in this period.</p> : <div className="operating-chart-plot">
      <ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 12, right: 20, bottom: 0, left: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="timestamp" type="number" domain={[ticks[0], ticks.at(-1)!]} ticks={ticks} tickFormatter={value => dateFormat.format(new Date(value))} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis width={60} domain={[0, metric.unit === 'stars' ? 5 : 'auto']} tickLine={false} axisLine={false} tickFormatter={value => `${metric.unit === 'usd' || metric.unit === 'price' ? '$' : ''}${Math.abs(value) >= 1000 ? `${number.format(value / 1000)}k` : number.format(value)}`} />
        <Tooltip labelFormatter={value => dateFormat.format(new Date(Number(value)))} formatter={(value, name) => [Array.isArray(value) ? value.map(item => amount(Number(item), metric.unit)).join(' – ') : amount(typeof value === 'number' ? value : null, metric.unit), name]} contentStyle={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 8 }} />
        {forecast.length > 0 && <ReferenceLine x={forecast[0].timestamp} stroke="var(--muted-foreground)" strokeDasharray="3 4" />}
        <Area type="linear" dataKey="spread" name="Historical spread (20–80%)" stroke="none" fill="var(--operating-forecast)" fillOpacity={0.18} connectNulls={false} isAnimationActive={false} />
        <Line type="linear" dataKey="actual" name={seriesName} stroke="var(--operating-actual)" strokeWidth={2} dot={{ r: smooth ? 0 : 2, fill: 'var(--operating-actual)', strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
        {metric.key === 'fuelCost' && <Line type="linear" dataKey="secondary" name="JunkWare recorded fuel" stroke="var(--operating-secondary)" strokeWidth={1.6} strokeDasharray="2 3" dot={false} connectNulls={false} isAnimationActive={false} />}
        <Line type="linear" dataKey="forecast" name="Baseline forecast" stroke="var(--operating-forecast)" strokeWidth={2.4} strokeDasharray="6 4" dot={{ r: 2.5 }} connectNulls={false} isAnimationActive={false} />
      </ComposedChart></ResponsiveContainer>
    </div>}
    <p className="operating-chart-latest">{latest ? `Latest ${seriesName}: ${amount(latest.actual, metric.unit)} · ${day(latest.date)}${smooth ? ` · ${averaged.find(row => row.date === latest.date)?.observedDays ?? 0}/7 observations` : ''}` : 'No observations in this history window.'}</p>
    {forecast.length > 0 && model && <p className="operating-model-note">{confidence} confidence · {day(forecast[0].date)}–{day(forecast.at(-1)!.date)} baseline · Backtest error {model.backtest.weightedAbsolutePercentError === null ? 'unavailable' : `${number.format(model.backtest.weightedAbsolutePercentError * 100)}% WAPE`} ({model.backtest.observations} tests).</p>}
    <p>{metric.note}</p>
    <details><summary>View daily values & source</summary><p>{metric.source}. Original daily records are unchanged. Blank values mean unavailable, not zero. Rates use summed numerators and denominators.</p><div className="operating-data-table"><table><thead><tr><th>Date</th><th>{metric.source}</th>{smooth && <><th>{seriesName}</th><th>Observations</th></>}{metric.key === 'fuelCost' && <th>JunkWare recorded fuel</th>}{forecast.length > 0 && <><th>Baseline</th><th>Historical spread</th></>}</tr></thead><tbody>{rawRows.map(row => { const avg = averaged.find(item => item.date === row.date); return <tr key={row.date}><td>{row.date}</td><td>{amount(row.actual, metric.unit)}</td>{smooth && <><td>{operatingDays && data.daily.find(item => item.date === row.date)?.jobDay === 'zero' ? 'Skipped: zero jobs' : amount(avg?.actual ?? null, metric.unit)}</td><td>{avg?.observedDays ?? 0}/7</td></>}{metric.key === 'fuelCost' && <td>{amount(row.secondary, metric.unit)}</td>}{forecast.length > 0 && <><td>{amount(row.forecast, metric.unit)}</td><td>{row.spread ? row.spread.map(value => amount(value, metric.unit)).join(' – ') : '—'}</td></>}</tr>; })}</tbody></table></div></details>
  </article>;
}

const titles: Record<AnalyticsScope, string> = { expenses: 'Fuel & disposal history', business: 'Business performance history', forecast: 'Operating forecast', marketing: 'Advertising & demand history', reviews: 'Review history', fleet: 'Truck usage & fuel history', jobs: 'Schedule volume history', labor: 'Labor cost history' };
export function OperatingTrends({ data, scope = 'expenses', focusMetric }: { data?: OperatingTrendsData | null; scope?: AnalyticsScope; focusMetric?: OperatingMetric }) {
  const [days, setDays] = useState(30);
  const [truck, setTruck] = useState('');
  const [smooth, setSmooth] = useState(true);
  const operatingDays = !['marketing', 'reviews'].includes(scope);
  const scoped = scopeOperatingTrends(data || null, scope);
  if (!scoped) return <section className="finance-performance-section"><h3>{titles[scope]}</h3><p role="status">Historical chart data is unavailable. Waiting for the prediction dataset refresh.</p></section>;
  const selectedTruck = scoped.trucks?.find(item => item.truck === truck);
  const chartData = selectedTruck ? { ...scoped, daily: selectedTruck.daily } : scoped;
  const wex = scoped.wexCoverage;
  const forecastPoints = scoped.forecasts.flatMap(model => model.points);
  return <section className="operating-trends" aria-label={titles[scope]}>
    <div className="finance-performance-chart-heading"><div><h3>{titles[scope]}</h3><p>Daily history through {scoped.historyThrough} · Gaps mean unavailable data. Each chart has its own value scale.</p></div><div className="operating-history" role="group" aria-label="Graph history"><span>Graph history</span><div>{[30, 90, 365].map(value => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}>{value} days</button>)}</div></div></div>
    {scope === 'fleet' && <label className="operating-truck-filter">Historical truck<select aria-label="Historical truck" value={selectedTruck?.truck || ''} onChange={event => setTruck(event.target.value)}><option value="">All trucks</option>{scoped.trucks?.map(item => <option key={item.truck} value={item.truck}>{item.truck}</option>)}</select></label>}
    {['expenses', 'forecast', 'fleet'].includes(scope) && <p className="operating-coverage">WEX imported history: {wex?.coverageFrom && wex.coverageThrough ? `${wex.coverageFrom}–${wex.coverageThrough} · ${wex.records} transactions · ${wex.status} coverage` : 'unavailable'}. WEX charts are limited to imported exports.</p>}
    {scope === 'forecast' && (forecastPoints.length > 0 ? <p>Dashed lines are planning baselines, not commitments. Shading is historical 20th–80th percentile spread, not a prediction interval. Fuel uses WEX where present and JunkWare otherwise. Today’s partial actuals are excluded.</p> : <p>Forecasts appear only for today with a current dataset; historical dates do not replay today’s model.</p>)}
    {scope === 'marketing' && <p>Tracked calls and provider conversions are not unique customers. A verified customer-acquisition-cost history is not available.</p>}
    {scope === 'reviews' && <p className="operating-coverage">Captured review history is partial; the latest 100 reviews per location are retained in each Podium snapshot.</p>}
    {scope !== 'forecast' && <div className="operating-history" role="group" aria-label="Graph presentation"><div><button aria-pressed={smooth} onClick={() => setSmooth(true)}>{operatingDays ? '7 operating days' : '7-day average'}</button><button aria-pressed={!smooth} onClick={() => setSmooth(false)}>Daily</button></div><p>{smooth ? operatingDays ? 'Average of the last 7 recorded operating days. Zero-job days are skipped; missing records remain gaps.' : 'Trailing 7-calendar-day average of available observations; missing records remain gaps.' : 'Original daily observations, including recorded zero-job days.'}</p></div>}
    <div className={`operating-chart-grid${focusMetric ? ' operating-chart-focused' : ''}`}>{scopeMetrics[scope].filter(key => !focusMetric || key === focusMetric).map(key => metrics.find(metric => metric.key === key)!).map(metric => <OperatingChart key={metric.key} data={chartData} metric={metric} days={days} smooth={smooth && scope !== 'forecast'} operatingDays={operatingDays} />)}</div>
    {['business', 'forecast', 'jobs'].includes(scope) && <OperatingPlanning data={scoped} showRevenue={scope !== 'jobs'} />}
    <details className="operating-method"><summary>{scope === 'forecast' ? 'Forecast method & freshness' : 'Sources & freshness'}</summary><p>Updated {new Date(scoped.generatedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })} Central. Current partial actuals are excluded. Existing source refreshes rebuild this dataset; this page does not fetch vendors.</p>{Object.entries(scoped.sourceCoverage || {}).map(([source, coverage]) => <p key={source}>{source}: {coverage.coverageFrom || 'unknown'}–{coverage.coverageThrough || 'unknown'} · {coverage.status}. {coverage.note}</p>)}{scope === 'forecast' && <p>The baseline is a recency-weighted average of up to eight prior matching weekdays, falling back to the last 28 observations when fewer than four matching weekdays exist. At least four observations are required. Backtesting uses up to 56 observed days; WAPE is total absolute forecast error divided by total absolute actual values. Missing days are not scored. No causal or multi-source predictive model is claimed.</p>}</details>
  </section>;
}
