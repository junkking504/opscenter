import type { DrivingScore } from './lib/driving-score';
import { drivingSummary } from './lib/driving-score';
import { DRIVING_SCORE_COMPENSATION_COPY, drivingScoreCompensationLabel } from '../lib/driving-score-policy';
import './driving-scores.css';
const value = (n: number | null, suffix = '') => n === null ? 'Unavailable' : `${n.toLocaleString('en-US', {maximumFractionDigits: 1})}${suffix}`;
export function DrivingScoreBadge({rows, onClick}: {rows: DrivingScore[]; onClick?: () => void}) {
  const row = rows.length === 1 ? rows[0] : null;
  const text = row ? row.display : rows.length ? `${rows.length} truck scores` : 'No driving data';
  const label = row ? row.attribution === 'confirmed' ? row.score === null ? row.status : drivingScoreCompensationLabel(row.score) : 'Truck score · review attribution' : '';
  return <button type="button" className="driving-score-badge" onClick={onClick} aria-label={`Driving score: ${text}${label ? `, ${label}` : ''}. Open breakdown`}><strong>{text}</strong>{label && <small>{label}</small>}</button>;
}
export function DrivingScoreDetails({rows}: {rows: DrivingScore[]}) {
  return <section className="driving-score-details"><header><h3>Driving score breakdown</h3><p>{DRIVING_SCORE_COMPENSATION_COPY}</p></header>{!rows.length && <p>No driving data available for this member and day.</p>}{rows.map(row => <article key={`${row.date}:${row.truck}`}>
    <h4>{row.truck} · {row.date}</h4><strong className="driving-score-value">{row.display}</strong>
    <p>{row.attribution === 'confirmed' ? `Driver: ${row.drivers.join(', ')}` : `Truck score · attribution needs review${row.drivers.length ? ` · ${row.drivers.join(', ')}` : ' · no confirmed driver'}`}</p>
    {row.score !== null && <p>{row.attribution === 'confirmed' ? drivingScoreCompensationLabel(row.score) : 'Individual bonus status requires confirmed attribution.'}</p>}
    <small>{row.status} · {row.source}</small>{row.warning && <p>{row.warning}</p>}
    <dl><div><dt>Miles</dt><dd>{value(row.miles)}</dd></div><div><dt>Drive time</dt><dd>{value(row.driveMinutes, ' min')}</dd></div><div><dt>Idle time</dt><dd>{value(row.idleMinutes, ' min')}</dd></div><div><dt>Safety score</dt><dd>{value(row.safetyScore)}</dd></div><div><dt>Idle score</dt><dd>{value(row.idleScore)}</dd></div></dl>
    <p>Overall score: 90% safety + 10% idle when idle data is available.</p>
    <table><thead><tr><th>Event</th><th>Count</th><th>Safety deduction</th></tr></thead><tbody>{row.events.map(event => <tr key={event.label}><th>{event.label}</th><td>{value(event.count)}</td><td>{event.deduction === null ? 'Excluded' : `−${event.deduction}`}</td></tr>)}<tr><th>After hours</th><td>—</td><td>{row.afterHoursPenalty === null ? 'Unavailable' : `−${row.afterHoursPenalty}`}</td></tr></tbody></table>
  </article>)}</section>;
}
export function DrivingPeriodSummary({members}: {members: Array<{id:string;name:string;drivingScores?:DrivingScore[]}>}) {
  return <section className="driving-period-summary"><h3>Pay-period driving review</h3><p>Confirmed, scorable days only. A day below 60 means at least one confirmed truck score was below 60. Review does not change payroll.</p><div className="driving-table-scroll"><table><thead><tr><th>Krewe member</th><th>Scored days</th><th>Days below 60</th><th>Attribution review days</th><th>Breakdown</th></tr></thead><tbody>{members.map(member => {const rows=member.drivingScores||[];const summary=drivingSummary(rows);return <tr key={member.id}><th>{member.name}</th><td>{summary.scoredDays}</td><td>{summary.belowDays}</td><td>{summary.reviewDays}</td><td><details><summary>View driving days</summary><DrivingScoreDetails rows={rows}/></details></td></tr>;})}</tbody></table></div></section>;
}
export function FleetDrivingScores({rows}: {rows: DrivingScore[]}) {
  return <section className="fleet-driving-scores"><h2>Driving Scores</h2><p>{DRIVING_SCORE_COMPENSATION_COPY}</p><p>Scores reflect each truck’s recorded driving. Shared or unconfirmed assignments require attribution review.</p>{!rows.length && <p>No truck scoring records are available for this day.</p>}<div className="driving-score-grid">{rows.map(row => <details key={row.truck}><summary><strong>{row.truck}</strong><b>{row.display}</b><span>{row.drivers.join(', ') || 'Unassigned'}</span><small>{row.attribution === 'confirmed' && row.score !== null ? drivingScoreCompensationLabel(row.score) : 'Truck score · review attribution'}</small><span>View breakdown</span></summary><DrivingScoreDetails rows={[row]}/></details>)}</div></section>;
}
