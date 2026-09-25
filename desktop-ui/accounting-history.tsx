import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FinancialStatement } from './lib/financial-statements';
import { accountingTrendRows } from './lib/accounting-trend';
import { commercialMoney } from './lib/commercial-contract';
import './operating-trends.css';

export function AccountingHistory({ records, selected }: { records: FinancialStatement[]; selected: FinancialStatement }) {
  const rows = accountingTrendRows(records, selected);
  return <section className="capital-panel operating-trends" aria-label="Accounting history">
    <h3>Monthly income & expenses</h3><p>{selected.company} · {selected.basis} basis · {selected.sourceKind === 'qbo' ? 'QuickBooks' : 'Accountant statements'}. Full calendar months only; partial or incompatible months are gaps.</p>
    <div className="operating-chart-legend"><span><i />Income</span><span><i className="secondary" />Total expenses</span><span><i className="forecast" />Net income (recorded)</span></div>
    {rows.some(row => row.income !== null) ? <div className="operating-chart-plot"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} accessibilityLayer margin={{ top: 10, right: 20, left: 5, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--border)"/><XAxis dataKey="month" tickFormatter={value => value.slice(2)} minTickGap={22}/><YAxis width={66} tickFormatter={value => `$${value / 1000}k`}/><Tooltip formatter={value => commercialMoney(typeof value === 'number' ? value : null)} contentStyle={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)' }}/><Bar dataKey="income" name="Income" fill="var(--operating-actual)" isAnimationActive={false}/><Bar dataKey="expenses" name="Total expenses" fill="var(--operating-secondary)" isAnimationActive={false}/><Line dataKey="netIncome" name="Net income (recorded)" stroke="var(--operating-forecast)" strokeWidth={2} connectNulls={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div> : <p>No comparable full-month statements are available for this selection.</p>}
    <p>Total expenses = cost of goods sold + operating expenses + other expenses. Net income is taken directly from the statement.</p>
    <p>Cash-flow graph unavailable: the imported data supplies profit-and-loss statements, not a statement of cash flows.</p>
    <details><summary>View monthly chart values</summary><div className="operating-data-table"><table><thead><tr><th>Month</th><th>Income</th><th>Total expenses</th><th>Net income</th><th>Coverage</th></tr></thead><tbody>{rows.map(row => <tr key={row.month}><td>{row.month}</td><td>{commercialMoney(row.income)}</td><td>{commercialMoney(row.expenses)}</td><td>{commercialMoney(row.netIncome)}</td><td>{row.status}</td></tr>)}</tbody></table></div></details>
  </section>;
}
