import { DeltaChip } from './delta-chip';
import type { DesktopKpi } from './lib/live-contract';
import { currentOperatingDay } from './lib/operating-day';

export const metricNumber = (value?: string) => value && /^-?\$?-?[\d,]+(?:\.\d+)?$/.test(value.trim()) ? Number(value.replace(/[$,]/g, '')) : null;
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export function CommandRevenueHero({ kpi, date, onOpen, disabled }: { kpi?: DesktopKpi; date: string; onOpen?: () => void; disabled?: boolean }) {
  const value = metricNumber(kpi?.value);
  const goal = kpi?.goal;
  const prior = kpi?.priorYear;
  const percent = value != null && goal != null && goal > 0 ? Math.max(0, value / goal * 100) : null;
  return <section className="command-revenue-hero" aria-label="Revenue pace">
    <div><DeltaChip current={value} comparison={kpi?.comparison} /><span className="hero-label">{date === currentOperatingDay() ? 'Today’s revenue' : 'Day’s revenue'}</span>
      <button className={value == null ? 'hero-value missing-value' : 'hero-value'} onClick={onOpen} disabled={disabled || !onOpen} title={value == null ? kpi?.detail || 'Revenue source unavailable' : 'Open revenue details'}>{value == null ? '—' : kpi?.value}</button>
      <small>{kpi?.detail || 'Revenue source unavailable'}</small>
    </div>
    <div className="hero-pace"><div><span>Daily goal {goal ? money(goal) : <span className="missing-value" title="Daily goal unavailable">—</span>}</span><strong>{value != null && goal ? `${money(Math.max(0, goal - value))} to go` : <span className="missing-value" title="Revenue and daily goal are required for pace">—</span>}</strong></div>
      {percent != null ? <progress max={100} value={Math.min(100, percent)} aria-label={`${percent.toFixed(0)}% of daily revenue goal`} /> : <div className="hero-pace-empty" title="Pace unavailable" />}
      <p>Same weekday last year{prior ? ` · ${prior.date}` : ''}: {prior?.value != null ? <><strong>{money(prior.value)}</strong>{value != null && <span> · {money(Math.abs(value - prior.value))} {value >= prior.value ? 'ahead' : 'behind'}</span>}</> : <span className="missing-value" title="No comparable saved revenue for the same weekday 52 weeks earlier">—</span>}</p>
      <small>Recorded revenue · {date === currentOperatingDay() ? 'Day in progress vs completed day' : 'Selected operating day'}</small>
    </div>
  </section>;
}
