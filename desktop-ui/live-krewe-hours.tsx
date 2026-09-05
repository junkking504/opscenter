import { useEffect, useState, type ReactNode } from 'react';
import type { KreweHoursSnapshot } from './lib/krewe-hours-contract';
import type { DesktopKreweSnapshot } from './lib/people-fleet-contract';
import { payForDays, payBreakdownDifference, type PayBreakdown } from './lib/krewe-pay-breakdown';
import './live-krewe-hours.css';

const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const hours = (n: number | null) => n === null ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} hrs`;
const money = (n: number | null) => n === null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const offsetDay = (date: string, offset: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
function Fact({ label, children, total = false, note }: { label: string; children: ReactNode; total?: boolean; note?: string }) {
  return <div className={`hours-fact${total ? ' pay-total' : ''}`}><span>{label}</span><strong>{children}</strong>{note && <small>{note}</small>}</div>;
}
function PayFacts({ pay }: { pay: PayBreakdown }) {
  return <><Fact label="Hourly Pay">{money(pay.labor)}</Fact><Fact label="Tips">{money(pay.tips)}</Fact><Fact label="Bonuses">{money(pay.bonuses)}</Fact>{pay.supplemental !== 0 && <Fact label="Supplemental Pay">{money(pay.supplemental)}</Fact>}<Fact label="Total Pay" total>{money(pay.totalPay)}</Fact></>;
}
function PayWarning({ pay }: { pay: PayBreakdown }) {
  const difference = payBreakdownDifference(pay);
  if (Object.values(pay).some(value => value === null)) return <p className="hours-record-warning">Pay Breakdown Incomplete · Missing amounts are not zero.</p>;
  if (difference !== null && Math.abs(difference) > .01) return <p className="hours-record-warning">Source Total Differs By {money(difference)} · Review Payroll</p>;
  return null;
}
export default function LiveKreweHours({ date, onDateChange, payroll, onRefresh }: { date: string; onDateChange?: (date: string) => void; payroll?: DesktopKreweSnapshot; onRefresh?: () => void }) {
  const [selectedDate, setSelectedDate] = useState(date);
  const changeDate = (next: string) => { setSelectedDate(next); onDateChange?.(next); };
  const [snapshot, setSnapshot] = useState<KreweHoursSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setSnapshot(null);
    fetch(`/api/desktop/krewe/hours?date=${selectedDate}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Employee hours are unavailable.'); return body as KreweHoursSnapshot; })
      .then(setSnapshot).catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedDate, refresh]);
  const employees = snapshot?.employees.filter(employee => employee.name.toLowerCase().includes(search.toLowerCase())) || [];
  const payMembers = new Map((payroll?.date === selectedDate ? payroll.members : []).map(member => [member.id, member]));
  return <section className="live-krewe-hours" aria-label="Pay-Period Hours and Pay">
    <header><div><h2>Pay-Period Hours and Pay</h2><p>{snapshot ? `${dayLabel(snapshot.start)} – ${dayLabel(snapshot.end)}, ${snapshot.end.slice(0, 4)}` : 'Employee Hours and Earnings'}</p></div><div className="hours-period-controls"><button disabled={loading} onClick={() => changeDate(offsetDay(snapshot?.start || selectedDate, -14))} aria-label="Previous pay period">←</button><label>Pay-Period Date<input type="date" value={selectedDate} onChange={event => { if (event.target.value) changeDate(event.target.value); }} /></label><button disabled={loading} onClick={() => changeDate(offsetDay(snapshot?.start || selectedDate, 14))} aria-label="Next pay period">→</button><button disabled={loading} onClick={() => { setRefresh(value => value + 1); onRefresh?.(); }}>Refresh</button></div></header>
    <div className="hours-toolbar"><label>Find Employee<input type="search" value={search} placeholder="Search employees" onChange={event => setSearch(event.target.value)} /></label><a href={`/crew?section=pay-period&date=${selectedDate}`} target="_blank" rel="noopener noreferrer">Open Full Pay-Period Records ↗</a></div>
    <p className="hours-source-note">Open each week for daily time and pay records. Hours include recorded corrections; pay follows published payroll. Open shifts are estimates and incomplete amounts remain unavailable.</p>
    {loading && <p role="status" className="hours-source-note">Loading Employee Hours…</p>}
    {error && <p role="alert" className="hours-source-note hours-attention">{error}</p>}
    {snapshot && <>
      {snapshot.missingDates.length > 0 && <p className="hours-source-note hours-attention">Daily Source Unavailable: {snapshot.missingDates.map(dayLabel).join(', ')}. Totals include available records only.</p>}
      <div className="hours-employee-cards">{employees.map(employee => {
        const days = payMembers.get(employee.id)?.days || [];
        const periodPay = payForDays(days, snapshot.start, snapshot.end);
        return <article className="hours-employee-card" key={employee.id} aria-label={employee.name}>
          <header><h3>{employee.name}</h3><span>Pay-Period Totals · {dayLabel(snapshot.start)} – {dayLabel(snapshot.end)}</span></header>
          <div className="hours-total-grid"><Fact label="Total Hours" note={`${hours(employee.weeks.reduce((sum, week) => sum + week.regular, 0))} regular · ${hours(employee.weeks.reduce((sum, week) => sum + week.overtime, 0))} OT`}>{hours(employee.total)}</Fact>{payroll && <PayFacts pay={periodPay} />}</div>
          {payroll && <PayWarning pay={periodPay} />}
          {employee.weeks.map((week, index) => {
            const weekPay = payForDays(days, week.start, week.end);
            return <details className="hours-week-dropdown" key={week.start}>
              <summary><span><strong>Week {index + 1}</strong><small>{dayLabel(week.start)} – {dayLabel(week.end)}</small></span><span>{hours(week.total)}</span>{payroll && <strong>{money(weekPay.totalPay)}</strong>}</summary>
              <div className="hours-week-content"><h4>Week {index + 1} Totals</h4><div className="hours-total-grid"><Fact label="Hours" note={`${hours(week.regular)} regular · ${hours(week.overtime)} OT`}>{hours(week.total)}</Fact>{payroll && <PayFacts pay={weekPay} />}</div>{payroll && <PayWarning pay={weekPay} />}
                <h4>Daily Totals</h4><div className="hours-daily-records" aria-label={`Week ${index + 1} daily breakdowns`}>{week.days.map(day => {
                  const pay = payForDays(days, day.date, day.date);
                  return <section className="hours-day-card" key={day.date} aria-label={`${day.date} daily totals`}>
                    <div className="hours-day-grid"><Fact label="Date" note={`${day.status}${day.corrected ? ' · Corrected' : ''}`}>{day.date}</Fact><Fact label="Clock In">{day.clockIn || '—'}</Fact><Fact label="Clock Out">{day.clockOut || '—'}</Fact><Fact label="Hours" note={day.overtime > 0 ? `${hours(day.overtime)} OT` : undefined}>{hours(day.hours)}</Fact><Fact label="Role">{day.role}</Fact><Fact label="Truck">{day.truck}</Fact>
                      <Fact label="Jobs">{day.jobs ?? '—'}</Fact><Fact label="Job Revenue Worked">{money(day.jobRevenueWorked)}</Fact>{payroll && <PayFacts pay={pay} />}
                    </div>{payroll && day.status !== 'Upcoming' && day.status !== 'No Record' && <PayWarning pay={pay} />}
                  </section>;
                })}</div>
              </div>
            </details>;
          })}
        </article>;
      })}</div>
      {!employees.length && <p className="hours-source-note">{snapshot.employees.length ? 'No employees match your search.' : 'No employee records are available for this pay period.'}</p>}
      <footer className="hours-source-note">{employees.length} Employees · Hours Updated {new Date(snapshot.generatedAt).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })} · Pay From Payroll Records</footer>
    </>}
  </section>;
}
