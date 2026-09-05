import { Fragment, useEffect, useState } from 'react';
import type { HoursWeek, KreweHoursSnapshot } from './lib/krewe-hours-contract';
import './live-krewe-hours.css';

const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const hours = (n: number | null) => n === null ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} hrs`;
const offsetDay = (date: string, offset: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
function WeekHours({ week }: { week: HoursWeek }) {
  return <><strong>{hours(week.total)}</strong><small>{week.total !== null ? `${hours(week.regular)} regular · ${hours(week.overtime)} OT` : week.days.every(day => day.status === 'Upcoming') ? 'Upcoming' : 'No Recorded Hours'}</small>{week.incomplete && <small className="hours-attention">Incomplete · Review Daily Records</small>}</>;
}
export default function LiveKreweHours({ date, onDateChange }: { date: string; onDateChange?: (date: string) => void }) {
  const [selectedDate, setSelectedDate] = useState(date);
  const changeDate = (next: string) => { setSelectedDate(next); onDateChange?.(next); };
  const [snapshot, setSnapshot] = useState<KreweHoursSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setSnapshot(null); setExpanded(null);
    fetch(`/api/desktop/krewe/hours?date=${selectedDate}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Employee hours are unavailable.'); return body as KreweHoursSnapshot; })
      .then(setSnapshot).catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedDate, refresh]);
  const employees = snapshot?.employees.filter(employee => employee.name.toLowerCase().includes(search.toLowerCase())) || [];
  return <section className="live-krewe-hours" aria-label="Pay-Period Hours">
    <header><div><h2>Pay-Period Hours</h2><p>{snapshot ? `${dayLabel(snapshot.start)} – ${dayLabel(snapshot.end)}, ${snapshot.end.slice(0, 4)}` : 'Employee Hours By Week'}</p></div><div className="hours-period-controls"><button disabled={loading} onClick={() => changeDate(offsetDay(snapshot?.start || selectedDate, -14))} aria-label="Previous pay period">←</button><label>Pay-Period Date<input type="date" value={selectedDate} onChange={event => { if (event.target.value) changeDate(event.target.value); }} /></label><button disabled={loading} onClick={() => changeDate(offsetDay(snapshot?.start || selectedDate, 14))} aria-label="Next pay period">→</button><button disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh</button></div></header>
    <div className="hours-toolbar"><label>Find Employee<input type="search" value={search} placeholder="Search employees" onChange={event => setSearch(event.target.value)} /></label><a href={`/crew?section=pay-period&date=${selectedDate}`} target="_blank" rel="noopener noreferrer">Open Full Pay-Period Records ↗</a></div>
    <p className="hours-source-note">Recorded hours and manager corrections · Overtime is calculated separately for each week. Open shifts are estimates as of refresh; incomplete records are flagged, not treated as confirmed zero hours.</p>
    {loading && <p role="status" className="hours-source-note">Loading Employee Hours…</p>}
    {error && <p role="alert" className="hours-source-note hours-attention">{error}</p>}
    {snapshot && <>
      {snapshot.missingDates.length > 0 && <p className="hours-source-note hours-attention">Daily Source Unavailable: {snapshot.missingDates.map(dayLabel).join(', ')}. Totals include available records only.</p>}
      <div className="hours-table-wrap"><table><thead><tr><th>Employee</th><th>Week 1<small>{dayLabel(snapshot.start)} – {dayLabel(offsetDay(snapshot.start, 6))}</small></th><th>Week 2<small>{dayLabel(offsetDay(snapshot.start, 7))} – {dayLabel(snapshot.end)}</small></th><th>Pay-Period Total<small>Recorded Hours</small></th></tr></thead><tbody>
        {employees.map(employee => <Fragment key={employee.id}><tr><th scope="row"><button className="hours-employee" aria-expanded={expanded === employee.id} onClick={() => setExpanded(expanded === employee.id ? null : employee.id)}>{employee.name}<small>{expanded === employee.id ? 'Hide Daily Hours −' : 'Show Daily Hours +'}</small></button></th>{employee.weeks.map(week => <td key={week.start}><WeekHours week={week} /></td>)}<td><strong>{hours(employee.total)}</strong><small>{employee.total === null ? 'No Recorded Hours' : `${hours(employee.weeks.reduce((sum, week) => sum + week.regular, 0))} regular · ${hours(employee.weeks.reduce((sum, week) => sum + week.overtime, 0))} OT`}</small>{employee.weeks.some(week => week.incomplete) && <small className="hours-attention">Incomplete</small>}</td></tr>
          {expanded === employee.id && <tr><td colSpan={4}><div className="hours-daily-weeks">{employee.weeks.map((week, index) => <section key={week.start} aria-label={`Week ${index + 1} daily hours`}><h3>Week {index + 1} · {dayLabel(week.start)} – {dayLabel(week.end)}</h3>{week.days.map(day => <div className="hours-daily-row" key={day.date}><span>{dayLabel(day.date)}<small>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' })}</small></span><span>{day.clockIn || '—'} – {day.clockOut || '—'}<small>{day.status}{day.corrected ? ' · Corrected' : ''}</small></span><strong>{hours(day.hours)}<small>{day.overtime > 0 ? `${hours(day.overtime)} OT` : ''}</small></strong></div>)}</section>)}</div></td></tr>}
        </Fragment>)}
      </tbody></table></div>
      {!employees.length && <p className="hours-source-note">{snapshot.employees.length ? 'No employees match your search.' : 'No employee records are available for this pay period.'}</p>}
      <footer className="hours-source-note">{employees.length} Employees · Updated {new Date(snapshot.generatedAt).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })}</footer>
    </>}
  </section>;
}
