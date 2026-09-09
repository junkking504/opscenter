import { useState } from 'react';
import { commercialMoney } from './lib/commercial-contract';
import { preferredStatements, statementMetrics, statementYearCoverage, type StatementData } from './lib/financial-statements';
import './financial-statements.css';

const money = (cents: number | null | undefined) => commercialMoney(cents == null ? null : cents / 100);
const label = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export function FinancialStatements({ data, date }: { data?: StatementData; date: string }) {
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedSource, setSelectedSource] = useState('');
  const [company, setCompany] = useState('');
  if (!data?.available) return <section className="statement-shell"><h2>Accounting Financials</h2><p>{data?.error || 'No financial statements have been imported.'}</p></section>;
  const companies = [...new Set(data.records.map(r => r.company))].sort();
  const activeCompany = companies.includes(company) ? company : companies[0];
  const records = data.records.filter(r => r.company === activeCompany);
  const preferred = preferredStatements(records);
  const defaultMonth = preferred.filter(r => r.month <= date.slice(0, 7)).at(-1)?.month;
  const activeMonth = preferred.some(r => r.month === selectedMonth) ? selectedMonth : defaultMonth;
  if (!activeMonth) return <section className="statement-shell"><h2>Accounting Financials</h2><p>No statement covers this operating date or an earlier month.</p></section>;
  const candidates = records.filter(r => r.month === activeMonth).sort((a, b) => b.reportThrough.localeCompare(a.reportThrough));
  const statement = candidates.find(r => r.id === selectedSource) || preferred.find(r => r.month === activeMonth)!;
  const total = statement.totals;
  const coverage = statementYearCoverage(records, activeMonth);
  const previousDate = new Date(`${activeMonth}-01T12:00:00Z`); previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
  const previous = preferred.find(r => r.month === previousDate.toISOString().slice(0, 7));
  const change = previous ? total.netIncome - previous.totals.netIncome : null;
  const basisComparable = previous?.basis === statement.basis && statement.basis !== 'Unspecified';
  return <section className="statement-shell" aria-label="Accounting financial statements">
    <header className="statement-header"><div><span className="section-kicker">Accountant statements · {activeCompany}</span><h2>Accounting Financials</h2><p>Reported book income and expenses · {statement.status} · {statement.basis === 'Unspecified' ? 'Accounting basis not stated' : `${statement.basis} basis`}</p></div><label>Statement month<select aria-label="Statement month" value={activeMonth} onChange={e => {setSelectedMonth(e.target.value); setSelectedSource('');}}>{preferred.map(r => <option key={r.month} value={r.month}>{label(r.month)}</option>)}</select></label></header>
    {companies.length > 1 && <label>Company<select value={activeCompany} onChange={e => {setCompany(e.target.value);setSelectedMonth('');setSelectedSource('');}}>{companies.map(name => <option key={name}>{name}</option>)}</select></label>}
    <div className="statement-kpis">{[['Income', total.income], ['Cost of goods sold', total.cogs], ['Operating expenses', total.expenses], ['Net income', total.netIncome]].map(([name, amount]) => <article key={String(name)}><span>{name}</span><strong>{money(Number(amount))}</strong><small>{statement.status} · {label(activeMonth)}</small></article>)}</div>
    <p className="statement-source">{statement.sourceName} · {statement.sheet} · Imported {new Date(data.importedAt!).toLocaleDateString('en-US')}<br/>Net margin {total.income ? `${(total.netIncome / total.income * 100).toFixed(1)}%` : 'unavailable'}{change != null && basisComparable ? ` · Net income change ${money(change)} vs ${label(previous!.month)}` : ' · Comparable month change unavailable until accounting bases are confirmed.'}</p>
    {statement.warnings.length > 0 && <div className="statement-review" role="note"><strong>Statement needs review</strong>{statement.warnings.map(w => <p key={w}>{w}</p>)}</div>}
    <p className="statement-coverage">{coverage.totals ? `Year to date through ${label(activeMonth)}: income ${money(coverage.totals.income)}, net income ${money(coverage.totals.netIncome)}.` : `Full year-to-date figures unavailable.${coverage.missing.length ? ` Missing statements: ${coverage.missing.map(label).join(', ')}.` : ' Accounting bases need confirmation.'}`} Historical drafts do not establish the current ledger balance.</p>
    {candidates.length > 1 && <div className="statement-review"><label>Statement version<select aria-label="Statement version" value={statement.id} onChange={e => setSelectedSource(e.target.value)}>{candidates.map(r => <option key={r.id} value={r.id}>{r.sourceName}</option>)}</select></label><p>The later reporting workbook revises this month. All versions remain available; figures are never added together.</p></div>}
    <details><summary>Monthly statements and expense detail</summary><div className="statement-table-scroll"><table><caption>Reported monthly results · newest reporting workbook for each month · USD</caption><thead><tr><th scope="col">Account</th>{preferred.map(r => <th scope="col" key={r.month}>{label(r.month)}<small>{r.status}</small></th>)}</tr></thead><tbody>{statementMetrics.map(([key, name]) => <tr key={key}><th scope="row">{name}</th>{preferred.map(r => <td key={r.month}>{money(r.totals[key])}</td>)}</tr>)}</tbody></table></div><h3>{label(activeMonth)} · Source detail</h3><div className="statement-table-scroll"><table><thead><tr><th scope="col">Account</th><th scope="col">Amount</th><th scope="col">Source cell</th></tr></thead><tbody>{statement.rows.map(r => <tr key={r.cell} className={r.label.startsWith('Total for') || r.label === 'Net Income' ? 'statement-total' : ''}><th scope="row">{r.label}</th><td>{r.cents === null ? '—' : money(r.cents)}</td><td>{statement.sheet}!{r.cell}</td></tr>)}</tbody></table></div></details>
    {(statement.supplemental.length > 0 || statement.annotations.length > 0) && <details><summary>Accountant notes and bonus calculations</summary><p>Supplemental calculations are preserved separately from reported net income. These notes do not authorize payments or adjustments.</p>{statement.annotations.map(a => <p key={a.cell}><strong>{statement.sheet}!{a.cell}</strong> {a.text}</p>)}<dl className="statement-notes">{statement.supplemental.map(r => <div key={r.cell}><dt>{r.label} <small>{statement.sheet}!{r.cell}</small></dt><dd>{r.cents === null ? '—' : r.label.startsWith('%') ? 'See original workbook' : money(r.cents)}</dd></div>)}</dl></details>}
    <p className="statement-source">QuickBooks supports ongoing financial reporting. Its existing OpsCenter connection currently supplies payment reconciliation; these imported drafts remain separate from a live QBO report.</p>
  </section>;
}
