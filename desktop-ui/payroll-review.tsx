import { useEffect, useState } from 'react';
import type { KreweHoursSnapshot } from './lib/krewe-hours-contract';
import type { DesktopKreweSnapshot } from './lib/people-fleet-contract';
import { buildPayrollReview, payrollReviewCsv, reviewedPayrollRows } from './lib/payroll-review';
import { PAYROLL_REPORT_RECIPIENTS, preparePayrollReportEmail, payrollReportMailto } from './lib/payroll-report-email';
import './payroll-review.css';

const money = (value: number | null) => value === null ? '—' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const hoursText = (value: number | null) => value === null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
export default function PayrollReview({ hours, payroll, unavailable, pending, search = '', onOpen }: {
  hours: KreweHoursSnapshot; payroll: DesktopKreweSnapshot; unavailable?: string; pending?: boolean; search?: string; onOpen: (id: string) => void;
}) {
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const rows = buildPayrollReview(hours, payroll);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  const missing = [...new Set([...hours.missingDates, ...payroll.missingDates])].sort();
  const warnings = [
    ...(hours.end >= today ? ['This pay period is still in progress. Export a draft for the recorded amounts so far.'] : []),
    ...(missing.length ? [`Daily sources unavailable: ${missing.join(', ')}.`] : []),
    ...(payroll.excludedPayNames?.length ? [`Zero-hour employees have recorded pay and are excluded from totals: ${payroll.excludedPayNames.join(', ')}. Review their time records.`] : []),
    ...(unavailable ? ['Refresh failed. Retrieve current records before exporting reviewed totals.'] : []),
  ];
  const reviewed = reviewedPayrollRows(rows, marks);
  const flagged = rows.filter(row => row.issues.length);
  const changed = rows.filter(row => marks[row.id] && marks[row.id] !== row.signature);
  useEffect(() => {
    if (!changed.length) return;
    setMarks(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !changed.some(row => row.id === id))));
    setNotice(`Source records changed for ${changed.map(row => row.name).join(', ')}. Review marks cleared for those employees.`);
  }, [changed]);
  const visible = rows.filter(row => row.name.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || filter === 'flags' && row.issues.length || filter === 'reviewed' && reviewed.includes(row)));
  const canReview = !warnings.length && !pending;
  function emailReport() {
    if (!canReview || !reviewed.length) return;
    try {
      const message = preparePayrollReportEmail({ rows: reviewed, start: hours.start, end: hours.end, retrievedAt: hours.generatedAt, totalEmployeeCount: rows.length, warnings });
      window.location.href = payrollReportMailto(message);
      setNotice('Finish sending in your mail app. The message includes the reviewed employee totals; CSV export is available separately. No email has been sent by OpsCenter.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'The email could not be prepared.'); }
  }
  function download(isReviewed: boolean) {
    const selected = isReviewed ? reviewed : rows;
    if (!selected.length || pending || isReviewed && !canReview) return;
    const csv = payrollReviewCsv({ rows: selected, start: hours.start, end: hours.end, retrievedAt: hours.generatedAt, reviewed: isReviewed, warnings });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `krewe-payroll-${hours.start}-${hours.end}-${isReviewed ? 'reviewed' : 'draft'}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported ${selected.length} ${isReviewed ? 'reviewed' : 'draft'} employee rows. ${isReviewed && selected.length < rows.length ? `${rows.length - selected.length} unreviewed employees were excluded.` : ''}`);
  }
  return <section className="payroll-review" aria-label="Payroll review">
    <header><div><h3>Payroll Review</h3><p>Review the recorded hours and earnings, then share the employees you have checked.</p></div><div className="payroll-review-actions"><button disabled={!rows.length || pending} onClick={() => download(false)}>Export draft ({rows.length})</button><button disabled={!reviewed.length || !canReview} onClick={() => download(true)}>Export reviewed ({reviewed.length})</button><button className="payroll-export-reviewed" disabled={!reviewed.length || !canReview} onClick={emailReport}>Email reviewed report ({reviewed.length})</button></div></header>
    <details className="payroll-email-recipients"><summary>Email to operations managers</summary><p>{PAYROLL_REPORT_RECIPIENTS.join(', ')}</p><p>Email opens a message in your mail app. Choose the sending mailbox and press Send there. It includes employee totals in the message; no automatic delivery is scheduled.</p></details>
    <div className="payroll-review-toolbar"><label>Show<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All employees ({rows.length})</option><option value="flags">Needs attention ({flagged.length})</option><option value="reviewed">Reviewed ({reviewed.length})</option></select></label><span>{reviewed.length} of {rows.length} reviewed · {flagged.length} need attention</span></div>
    {warnings.map(warning => <p className="payroll-review-warning" key={warning}>{warning}</p>)}
    <div className="payroll-review-scroll" tabIndex={0} role="region" aria-label="Employee payroll totals"><table><thead><tr><th scope="col">Reviewed</th><th scope="col">Employee</th><th scope="col">Week 1</th><th scope="col">Week 2</th><th scope="col">Reg / OT hrs</th><th scope="col">Hourly pay</th><th scope="col">Tips</th><th scope="col">Bonuses</th><th scope="col">Supplemental</th><th scope="col">Total pay</th><th scope="col">Review</th></tr></thead><tbody>{visible.map(row => <tr key={row.id} className={row.issues.length ? 'payroll-row-flagged' : ''}>
      <td><input type="checkbox" aria-label={`Reviewed ${row.name}`} checked={reviewed.includes(row)} disabled={!canReview || row.issues.length > 0} onChange={event => setMarks(previous => ({ ...previous, [row.id]: event.target.checked ? row.signature : '' }))} /></td>
      <th scope="row"><button onClick={() => onOpen(row.id)}>{row.name}</button><small>{hoursText(row.hours)} total hrs</small></th>
      <td>{hoursText(row.weeks[0]?.hours ?? null)}</td><td>{hoursText(row.weeks[1]?.hours ?? null)}</td><td>{hoursText(row.regular)} reg<small className="payroll-ot-hours">{hoursText(row.overtime)} OT</small></td><td>{money(row.pay.labor)}</td><td>{money(row.pay.tips)}</td><td>{money(row.pay.bonuses)}</td><td>{money(row.pay.supplemental)}</td><td><strong>{money(row.pay.totalPay)}</strong></td>
      <td>{row.issues.length ? <details><summary>{row.issues.length} flags</summary><ul>{row.issues.map(issue => <li key={`${issue.date}:${issue.message}`}>{issue.date && <strong>{issue.date}: </strong>}{issue.message}</li>)}</ul></details> : <span>{reviewed.includes(row) ? 'Reviewed' : 'Ready to review'}</span>}<button onClick={() => onOpen(row.id)}>Source days</button></td>
    </tr>)}</tbody></table></div>
    {!visible.length && <p className="payroll-review-note">No employees in this view.</p>}
    <footer className="payroll-review-note">Review marks apply to this session and clear when the supporting records change. Export reviewed includes only checked employees; draft includes all listed employees and flags. Amounts are before deductions. A review does not submit payroll or change pay records.</footer>
    {notice && <p role="status" className="payroll-review-note">{notice}</p>}
  </section>;
}
