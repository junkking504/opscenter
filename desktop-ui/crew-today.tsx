import { truckDisplayText } from '../lib/junkware-trucks';
import { useState } from 'react';
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
  const members = snapshot.members;
  const query = search.trim().toLocaleLowerCase();
  const ranked = [...members].sort((a, b) => (b.revenue ?? -Infinity) - (a.revenue ?? -Infinity) || a.name.localeCompare(b.name));
  const visible = (view === 'production' ? ranked : [...members].sort((a, b) => a.name.localeCompare(b.name))).filter(member =>
    `${member.name} ${member.truck}`.toLocaleLowerCase().includes(query) &&
    (filter === 'all' || filter === 'attention' && Boolean(member.issue) || filter === 'unassigned' && member.truck === 'Unassigned')
  );
  const totals = snapshot.totals;
  return <div className="crew-today">
    <div className="krewe-kpi-strip" aria-label="Selected day’s full crew summary">
      <article><span>Crew count</span><strong>{members.filter(member => member.working).length}</strong><small>Recorded clock-in for this day</small></article>
      <article><span>Crew revenue</span><strong>{money(totals.revenue)}</strong><small>Credited to clocked-in crew</small></article>
      <article><span>Average RPH</span><strong>{money(totals.hours && totals.revenue !== null ? totals.revenue / totals.hours : null)}</strong><small>Available worked hours</small></article>
      <article><span>Employee total earnings</span><strong>{money(totals.totalPay)}</strong><small>{snapshot.payrollVisible ? 'Available payroll rows only' : 'Manager access required'}</small></article>
    </div>
    <section className="crew-today-roster" aria-label="Today’s crew roster">
      <header className="crew-today-heading"><div><h2>Today’s crew</h2><p>{visible.length} of {members.length} shown · Includes completed shifts</p></div>
        <nav className="crew-section-nav" aria-label="Today sections">
          <button type="button" aria-pressed={view === 'pay'} onClick={() => setView('pay')}>{snapshot.payrollVisible ? 'Pay & hours' : 'Hours & assignments'}</button>
          <button type="button" aria-pressed={view === 'production'} onClick={() => setView('production')}>Production & driving</button>
        </nav>
      </header>
      <div className="crew-today-toolbar">
        <label>Find employee or truck<input type="search" value={search} placeholder="Search name or truck" onChange={event => setSearch(event.target.value)} /></label>
        <label>Show<select value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">All crew ({members.length})</option>
          <option value="attention">Needs attention ({members.filter(member => member.issue).length})</option>
          <option value="unassigned">Unassigned ({members.filter(member => member.truck === 'Unassigned').length})</option>
        </select></label>
        {(search || filter !== 'all') && <button type="button" onClick={() => { setSearch(''); setFilter('all'); }}>Clear filters</button>}
      </div>
      <div className={`crew-today-list crew-today-${view}`}>
        {visible.map(member => <article key={member.id} className={`crew-today-row${member.issue ? ' needs-attention' : ''}`} aria-label={member.name}>
          <div className="crew-today-person"><span className="crew-today-avatar">{member.initials}</span><div><h3>{member.name}</h3><p>{member.role} · {truckDisplayText(member.truck || 'Unassigned')}</p></div></div>
          {view === 'pay' ? <>
            <div className="crew-today-fact"><span>{member.status}</span><strong>{clockDurationLabel(member, date, now)}</strong><small>{member.clockIn || 'No clock-in'}{member.clockOut ? ` – ${member.clockOut}` : ''}</small></div>
            <div className="crew-today-fact crew-today-pay"><span>Total pay</span><strong>{money(member.totalPay)}</strong><small>Before deductions</small></div>
            <div className="crew-today-actions"><button type="button" onClick={() => onOpen(member, 'pay')} aria-label={`View ${snapshot.payrollVisible ? 'pay' : 'record'} for ${member.name}`}>{snapshot.payrollVisible ? 'View pay' : 'View record'}</button>{snapshot.canWrite && <button type="button" className="crew-today-edit" aria-label={`Edit hours for ${member.name}`} onClick={() => onOpen(member, 'hours')}>Edit hours</button>}</div>
          </> : <>
            <div className="crew-today-fact"><span>Revenue rank {ranked.indexOf(member) + 1}</span><strong>{money(member.revenue)}</strong><small>{metric(member.jobs)} jobs · Credited revenue</small></div>
            <div className="crew-today-fact"><span>Revenue / hour</span><strong>{money(member.hours && member.revenue !== null ? member.revenue / member.hours : null)}</strong></div>
            <div className="crew-today-driving"><span>Driving</span><DrivingScoreBadge rows={member.drivingScores || []} onClick={() => onOpen(member, 'driving')} /></div>
          </>}
          {member.issue && <button type="button" className="crew-today-issue" aria-label={`Review issue for ${member.name}`} onClick={() => onOpen(member, issuePanel(member.issue, snapshot.canWrite))}>
            <span className="crew-today-issue-copy"><strong>Needs attention</strong><span>{member.issue}</span></span>
            <span className="crew-today-issue-action">Review issue <span aria-hidden="true">→</span></span>
          </button>}
        </article>)}
        {!visible.length && <div className="crew-today-empty" role="status">{members.length ? 'No crew match these filters.' : 'No crew have a recorded clock-in for this day.'}{members.length > 0 && <button type="button" onClick={() => { setSearch(''); setFilter('all'); }}>Show all crew</button>}</div>}
      </div>
    </section>
  </div>;
}
