import { SectionLayout } from './section-layout';
import { MetricValue } from './metric-value';
import { DeltaChip } from './delta-chip';
import { crewRph, employeeRph } from './lib/crew-rph';
import { truckDisplayText } from '../lib/junkware-trucks';
import { useEffect, useState } from 'react';
import { WeeklyHoursMeter } from './krewe-presentation';
import { weeklyHours } from './lib/krewe-presentation';
import type { KreweHoursSnapshot } from './lib/krewe-hours-contract';
import { DrivingScoreBadge } from './driving-scores';
import { clockDurationLabel } from './lib/krewe-clock-duration';
import type { DesktopCrewMember, DesktopKreweSnapshot } from './lib/people-fleet-contract';
import './crew-today.css';

const money = (value: number | null) => value === null ? '—' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const metric = (value: number | null) => value === null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
type RecordPanel = 'pay' | 'hours' | 'driving';
const issuePanel = (issue: string, canWrite: boolean): RecordPanel => canWrite && /missing (?:clock|shift)|shift hours|hourly rate require review/i.test(issue) ? 'hours' : 'pay';

export default function CrewToday({ snapshot, date, now, onOpen }: {
  snapshot: DesktopKreweSnapshot; date: string; now: number;
  onOpen: (member: DesktopCrewMember, panel: RecordPanel) => void;
}) {
  const [view, setView] = useState<'pay' | 'production'>('pay');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [weekSource, setWeekSource] = useState<KreweHoursSnapshot>();
  useEffect(() => {
    if (!snapshot.payrollVisible) return;
    const abort = new AbortController();
    void fetch(`/api/desktop/krewe/hours?date=${encodeURIComponent(date)}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]) })
      .then(async response => { if (!response.ok) throw new Error('Weekly hours unavailable'); return response.json() as Promise<KreweHoursSnapshot>; })
      .then(body => { if (!abort.signal.aborted) setWeekSource(body); })
      .catch(() => { if (!abort.signal.aborted) setWeekSource(undefined); });
    return () => abort.abort();
  }, [date, snapshot]);
  const members = snapshot.members;
  const query = search.trim().toLocaleLowerCase();
  const ranked = [...members].sort((a, b) => (b.revenue ?? -Infinity) - (a.revenue ?? -Infinity) || a.name.localeCompare(b.name));
  const visible = (view === 'production' ? ranked : [...members].sort((a, b) => a.name.localeCompare(b.name))).filter(member =>
    `${member.name} ${member.truck}`.toLocaleLowerCase().includes(query) &&
    (filter === 'all' || filter === 'attention' && Boolean(member.issue) || filter === 'unassigned' && member.truck === 'Unassigned')
  );
  const totals = snapshot.totals;
  const rph = crewRph(snapshot);
  return <SectionLayout as="div" group="crew-today-1" className="crew-today">
    <div data-layout-id="krewe-kpi-strip" className="krewe-kpi-strip" aria-label="Selected day’s full crew summary">
      <article><span>Krewe count</span><DeltaChip current={members.filter(member => member.working).length} comparison={snapshot.comparison && {prior:snapshot.comparison.count,label:snapshot.comparison.label}} /><strong><MetricValue value={members.filter(member => member.working).length} /></strong><small>Clocked in today</small></article>
      <article><span>Krewe revenue</span><DeltaChip current={totals.revenue} comparison={snapshot.comparison && {prior:snapshot.comparison.totals.revenue,label:snapshot.comparison.label}} /><strong><MetricValue value={money(totals.revenue)} /></strong><small>Credited to clocked-in crew</small></article>
      <article><span>Average RPH</span><DeltaChip current={rph.value} comparison={snapshot.comparison && {prior:snapshot.comparison.rph,label:snapshot.comparison.label}} /><strong><MetricValue value={rph.value === null ? 'Unavailable' : money(rph.value)} /></strong><small>{rph.included} with valid worked hours{rph.excluded ? ` · ${rph.excluded} excluded` : ''}</small></article>
      {snapshot.payrollVisible && <article><span>Employee total earnings</span><DeltaChip current={totals.totalPay} comparison={snapshot.comparison && {prior:snapshot.comparison.totals.totalPay,label:snapshot.comparison.label}} lowerIsBetter /><strong><MetricValue value={money(totals.totalPay)} /></strong><small>{snapshot.payrollVisible ? 'Available payroll rows only' : 'Manager access required'}</small></article>}
    </div>
    <section data-layout-id="crew-today-roster" className="crew-today-roster" aria-label="Today’s krewe roster">
      <header className="crew-today-heading"><div><h2>Today</h2><p>{visible.length} of {members.length} shown · Includes completed shifts</p></div>
        <nav className="crew-section-nav" aria-label="Today sections">
          <button type="button" aria-pressed={view === 'pay'} onClick={() => setView('pay')}>{snapshot.payrollVisible ? 'Pay & hours' : 'Hours & assignments'}</button>
          <button type="button" aria-pressed={view === 'production'} onClick={() => setView('production')}>Production & driving</button>
        </nav>
      </header>
      <div className="crew-today-toolbar">
        <label>Find employee or truck<input type="search" value={search} placeholder="Search name or truck" onChange={event => setSearch(event.target.value)} /></label>
        <label>Show<select value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">All Krewe ({members.length})</option>
          <option value="attention">Needs attention ({members.filter(member => member.issue).length})</option>
          <option value="unassigned">Unassigned ({members.filter(member => member.truck === 'Unassigned').length})</option>
        </select></label>
        {(search || filter !== 'all') && <button type="button" onClick={() => { setSearch(''); setFilter('all'); }}>Clear filters</button>}
      </div>
      <div className={`crew-today-list crew-today-${view}`}>
        {visible.map(member => <article key={member.id} className={`crew-today-row${member.issue ? ' needs-attention' : ''}`} aria-label={member.name}>
          <div className="crew-today-person"><span className="crew-today-avatar">{member.initials}</span><div><h3>{member.name}</h3><p>{member.role} · {truckDisplayText(member.truck || 'Unassigned')}</p></div></div>
          <div className="crew-today-fact crew-today-rph"><span>RPH</span><strong><MetricValue value={snapshot.missingDates.length || employeeRph(member) === null ? 'Unavailable' : money(employeeRph(member))} /></strong><small>Revenue per labor hour</small></div>
          {view === 'pay' ? <>
            <div className="crew-today-fact"><span>{member.status}</span><strong><MetricValue value={clockDurationLabel(member, date, now)} /></strong><small>{member.clockIn || 'No clock-in'}{member.clockOut ? ` – ${member.clockOut}` : ''}</small></div>
            {snapshot.payrollVisible && <div className="crew-today-fact crew-today-pay"><span>Total Pay</span><strong><MetricValue value={money(member.totalPay)} /></strong><small>Before deductions</small></div>}
            <div className="crew-today-actions"><button type="button" onClick={() => onOpen(member, 'pay')} aria-label={`View ${snapshot.payrollVisible ? 'pay' : 'record'} for ${member.name}`}>{snapshot.payrollVisible ? 'View pay' : 'View record'}</button>{snapshot.canWrite && <button type="button" className="crew-today-edit" aria-label={`Edit hours for ${member.name}`} onClick={() => onOpen(member, 'hours')}>Edit Hours · Edits Payroll</button>}</div>
          </> : <>
            <div className="crew-today-fact"><span>Revenue rank {ranked.indexOf(member) + 1}</span><strong><MetricValue value={money(member.revenue)} /></strong><small>{metric(member.jobs)} jobs · Credited revenue</small></div>
            <div className="crew-today-driving"><span>Driving</span><DrivingScoreBadge rows={member.drivingScores || []} onClick={() => onOpen(member, 'driving')} /></div>
          </>}
          <WeeklyHoursMeter hours={snapshot.payrollVisible ? weeklyHours(weekSource, member.id, date) : null}/>
          {member.issue && <button type="button" className="crew-today-issue" aria-label={`Review issue for ${member.name}`} onClick={() => onOpen(member, issuePanel(member.issue, snapshot.canWrite))}>
            <span className="crew-today-issue-copy"><strong>Needs attention</strong><span>{member.issue}</span></span>
            <span className="crew-today-issue-action">Review issue <span aria-hidden="true">→</span></span>
          </button>}
        </article>)}
        {!visible.length && <div className="crew-today-empty" role="status">{members.length ? 'No Krewe match these filters.' : 'No Krewe have a recorded clock-in for this day.'}{members.length > 0 && <button type="button" onClick={() => { setSearch(''); setFilter('all'); }}>Show All Krewe</button>}</div>}
      </div>
    </section>
  </SectionLayout>;
}
