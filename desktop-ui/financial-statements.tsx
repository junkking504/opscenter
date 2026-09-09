import { useState } from 'react';
import { commercialMoney } from './lib/commercial-contract';
import { preferredStatements, statementMetrics, statementYearCoverage, type StatementData } from './lib/financial-statements';
import './financial-statements.css';

const money = (cents: number | null | undefined) => commercialMoney(cents == null ? null : cents / 100);
const label = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export function FinancialStatements({ data, date, onRefresh }: { data?: StatementData; date: string; onRefresh?: () => void }) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  async function refreshQbo() {
    setRefreshing(true);setRefreshMessage("Refreshing QuickBooks reports…");
    try { const response = await fetch("/api/desktop/finance/statements", {method:"POST",credentials:"same-origin",signal:AbortSignal.timeout(90000)}); const result = await response.json().catch(() => ({error: "QuickBooks refresh is temporarily unavailable. Previous statements retained."})); if (!response.ok || typeof result.message !== "string") throw new Error(result.error || "Report refresh failed. Previous statements retained.");setRefreshMessage(result.message);onRefresh?.(); }
    catch (error) {setRefreshMessage(error instanceof Error ? error.message : "QBO refresh failed. Previous statements retained.");}
    finally {setRefreshing(false);}
  }
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedSource, setSelectedSource] = useState('');
  const [sourceKind, setSourceKind] = useState<"workbook" | "qbo" | "">("");
  const [company, setCompany] = useState('');
  if (!data?.available) return <section className="statement-shell"><h2>Accounting Financials</h2><p>{data?.error || 'No financial statements have been imported.'}</p></section>;
  const activeKind = sourceKind || (data.records.some(r => r.sourceKind === "qbo") ? "qbo" : "workbook");
  const sourceRecords = data.records.filter(r => r.sourceKind === activeKind);
  const companies = [...new Set(sourceRecords.map(r => r.company))].sort();
  const activeCompany = companies.includes(company) ? company : companies[0];
  const records = sourceRecords.filter(r => r.company === activeCompany);
  const preferred = preferredStatements(records);
  const defaultMonth = preferred.filter(r => r.month <= date.slice(0, 7)).at(-1)?.month;
  const activeMonth = preferred.some(r => r.month === selectedMonth) ? selectedMonth : defaultMonth;
  if (!activeMonth) return <section className="statement-shell"><h2>Accounting Financials</h2><p>No statement covers this operating date or an earlier month.</p></section>;
  const candidates = records.filter(r => r.month === activeMonth).sort((a, b) => b.reportThrough.localeCompare(a.reportThrough));
  const statement = candidates.find(r => r.id === selectedSource) || preferred.find(r => r.month === activeMonth)!;
  const total = statement.totals;
  const yearRows = preferred.filter(r => r.month.slice(0, 4) === activeMonth.slice(0, 4));
  const priorYearMonth = `${Number(activeMonth.slice(0, 4)) - 1}-${activeMonth.slice(5)}`;
  const priorYearStatement = preferred.find(r => r.month === priorYearMonth);
  const priorYearCoverage = statementYearCoverage(records, priorYearMonth);
  const sameCutoff = statement.periodEnd && priorYearStatement?.periodEnd && statement.periodEnd.slice(5) === priorYearStatement.periodEnd.slice(5);
  const draft = preferredStatements(data.records.filter(r => r.sourceKind === "workbook" && r.company === activeCompany)).find(r => r.month === activeMonth);
  const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
  const coverage = statementYearCoverage(records, activeMonth);
  const previousDate = new Date(`${activeMonth}-01T12:00:00Z`); previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
  const previous = preferred.find(r => r.month === previousDate.toISOString().slice(0, 7));
  const change = previous ? total.netIncome - previous.totals.netIncome : null;
  const basisComparable = previous?.basis === statement.basis && statement.basis !== 'Unspecified' && (!statement.periodEnd || statement.periodEnd === lastDay(activeMonth)) && (!previous?.periodEnd || previous.periodEnd === lastDay(previous.month));
  return <section className="statement-shell" aria-label="Accounting financial statements">
    <header className="statement-header"><div><span className="section-kicker">{activeKind === "qbo" ? "QuickBooks Online" : "Accountant statements"} · {activeCompany}</span><h2>Accounting Financials</h2><p>Reported book income and expenses · {statement.status} · {statement.basis === 'Unspecified' ? 'Accounting basis not stated' : `${statement.basis} basis`}</p></div><label>Statement month<select aria-label="Statement month" value={activeMonth} onChange={e => {setSelectedMonth(e.target.value); setSelectedSource('');}}>{preferred.map(r => <option key={r.month} value={r.month}>{label(r.month)}</option>)}</select></label></header>
    <label className="statement-source-choice">Financial source<select aria-label="Financial source" value={activeKind} onChange={e => {setSourceKind(e.target.value as "workbook" | "qbo");setSelectedSource("");}}>{data.records.some(r => r.sourceKind === "qbo") && <option value="qbo">QuickBooks current books</option>}{data.records.some(r => r.sourceKind === "workbook") && <option value="workbook">Accountant draft statements</option>}</select></label>
    {activeKind === "qbo" && <div className="statement-refresh"><button type="button" disabled={refreshing} onClick={() => void refreshQbo()}>{refreshing ? "Refreshing QuickBooks…" : "Refresh QuickBooks reports"}</button><span>Read-only · Recent reports reused for 15 minutes</span></div>}
    {refreshMessage && <p role="status">{refreshMessage}</p>}
    {statement.periodEnd && <p>Reporting through {statement.periodEnd} · Retrieved {new Date(statement.observedAt!).toLocaleString("en-US")} · {statement.periodEnd === lastDay(activeMonth) ? "Full calendar month" : "Partial month"}</p>}
    {companies.length > 1 && <label>Company<select value={activeCompany} onChange={e => {setCompany(e.target.value);setSelectedMonth('');setSelectedSource('');}}>{companies.map(name => <option key={name}>{name}</option>)}</select></label>}
    <div className="statement-kpis">{[['Income', total.income], ['Cost of goods sold', total.cogs], ['Operating expenses', total.expenses], ['Net income', total.netIncome]].map(([name, amount]) => <article key={String(name)}><span>{name}</span><strong>{money(Number(amount))}</strong><small>{statement.status} · {label(activeMonth)}</small></article>)}</div>
    <p className="statement-source">{statement.sourceName} · {statement.sheet} · Sources imported {new Date(data.importedAt!).toLocaleDateString('en-US')}<br/>Net margin {total.income ? `${(total.netIncome / total.income * 100).toFixed(1)}%` : 'unavailable'}{change != null && basisComparable ? ` · Net income change ${money(change)} vs ${label(previous!.month)}` : ' · Comparable full-month change unavailable.'}</p>
    {statement.warnings.length > 0 && <div className="statement-review" role="note"><strong>Statement needs review</strong>{statement.warnings.map(w => <p key={w}>{w}</p>)}</div>}
    <p className="statement-coverage">{coverage.totals ? `Year to date through ${statement.periodEnd || label(activeMonth)}: income ${money(coverage.totals.income)}, total expenses ${money(coverage.totals.cogs + coverage.totals.expenses + coverage.totals.otherExpenses)}, net income ${money(coverage.totals.netIncome)}.` : `Full year-to-date figures unavailable.${coverage.missing.length ? ` Missing statements: ${coverage.missing.map(label).join(', ')}.` : ' Accounting bases need confirmation.'}`} {activeKind === "workbook" ? "Historical drafts do not establish the current ledger balance." : "Bookkeeping completeness is separate from report coverage."}</p>
    {activeKind === "qbo" && <p>{coverage.totals && priorYearCoverage.totals && sameCutoff ? `Same-period prior year through ${priorYearStatement!.periodEnd}: income ${money(priorYearCoverage.totals.income)}, net income ${money(priorYearCoverage.totals.netIncome)}. YTD income change ${money(coverage.totals.income - priorYearCoverage.totals.income)}${priorYearCoverage.totals.income ? ` (${((coverage.totals.income - priorYearCoverage.totals.income) / Math.abs(priorYearCoverage.totals.income) * 100).toFixed(1)}%)` : ""}.` : "Matching prior-year coverage is unavailable."}</p>}
    {activeKind === "qbo" && draft && <div className="statement-review"><strong>Accountant draft for {label(activeMonth)}</strong><p>Draft income {money(draft.totals.income)} · Draft net income {money(draft.totals.netIncome)}. {draft.basis === "Unspecified" ? "The draft does not state its accounting basis." : `${draft.basis} basis.`} Switch Financial source to inspect its revisions and notes. QBO has not overwritten the draft.</p></div>}
    {candidates.length > 1 && <div className="statement-review"><label>Statement version<select aria-label="Statement version" value={statement.id} onChange={e => setSelectedSource(e.target.value)}>{candidates.map(r => <option key={r.id} value={r.id}>{r.sourceName}</option>)}</select></label><p>The later reporting workbook revises this month. All versions remain available; figures are never added together.</p></div>}
    <details><summary>Monthly statements and expense detail</summary><div className="statement-table-scroll"><table><caption>Reported monthly results · {activeKind === "qbo" ? "QuickBooks current books" : "newest reporting workbook for each month"} · USD</caption><thead><tr><th scope="col">Account</th>{yearRows.map(r => <th scope="col" key={r.month}>{label(r.month)}<small>{r.status}{r.periodEnd && r.periodEnd !== lastDay(r.month) ? ` · through ${r.periodEnd}` : ""}</small></th>)}</tr></thead><tbody>{statementMetrics.map(([key, name]) => <tr key={key}><th scope="row">{name}</th>{yearRows.map(r => <td key={r.month}>{money(r.totals[key])}</td>)}</tr>)}</tbody></table></div><h3>{label(activeMonth)} · Source detail</h3><div className="statement-table-scroll"><table><thead><tr><th scope="col">Account</th><th scope="col">Amount</th><th scope="col">Source reference</th></tr></thead><tbody>{statement.rows.map(r => <tr key={r.cell} className={r.label.startsWith('Total for') || r.label === 'Net Income' ? 'statement-total' : ''}><th scope="row">{r.label}</th><td>{r.cents === null ? '—' : money(r.cents)}</td><td>{statement.sheet}!{r.cell}</td></tr>)}</tbody></table></div></details>
    {(statement.supplemental.length > 0 || statement.annotations.length > 0) && <details><summary>Accountant notes and bonus calculations</summary><p>Supplemental calculations are preserved separately from reported net income. These notes do not authorize payments or adjustments.</p>{statement.annotations.map(a => <p key={a.cell}><strong>{statement.sheet}!{a.cell}</strong> {a.text}</p>)}<dl className="statement-notes">{statement.supplemental.map(r => <div key={r.cell}><dt>{r.label} <small>{statement.sheet}!{r.cell}</small></dt><dd>{r.cents === null ? '—' : r.label.startsWith('%') ? 'See original workbook' : money(r.cents)}</dd></div>)}</dl></details>}
    <p className="statement-source">QuickBooks reports are read-only snapshots. Report refreshes and accountant draft imports are separate; neither posts transactions or approves a financial close.</p>
  </section>;
}
