import type { FuelReconciliation as FuelData, FuelMatchStatus } from './lib/fuel-reconciliation-contract';
import { commercialMoney as money } from './lib/commercial-contract';
const labels: Record<FuelMatchStatus, string> = { matched: 'Matched', amount_difference: 'Amount difference', ambiguous: 'Review match', awaiting_wex: 'Awaiting WEX match', wex_only: 'No reported match' };
export function FuelReconciliation({ data }: { data?: FuelData }) {
  if (!data) return null;
  return <section className="finance-cost-shell finance-fuel-reconciliation" aria-label="Fuel reconciliation" id="fuel-reconciliation">
    <div className="section-title"><div><span className="section-kicker">{data.date} · WEX and reported expenses</span><h2>Fuel Reconciliation</h2>
      <p>{data.matchedCount} matched · {data.differenceCount} amount differences. Pending matches remain open until source evidence is available.</p></div></div>
    <p>Reported detail {money(data.reportedTotal)} · WEX fuel {money(data.wexFuelTotal)}. These are separate source totals and are not added together.</p>
    <p>{data.wexImportedAt ? `WEX last imported ${new Date(data.wexImportedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT.` : 'WEX source unavailable.'} Reported detail may have incomplete coverage.</p>
    <div className="finance-cost-list">{data.rows.map(row => <article key={row.id}>
      <div><strong>{row.truck} · {row.location || 'Location not recorded'}</strong><small>{labels[row.status]}</small><small>{row.reason}</small>
        <small>Reported {money(row.reportedAmount)} · WEX fuel {money(row.wexFuelAmount)}{row.difference !== null ? ` · Difference ${money(row.difference)}` : ''}</small>
        {row.wexId && <small>WEX transaction {row.wexId} · Net charge {money(row.wexNetAmount)}</small>}
      </div><span>{row.reportedId ? <a href="https://junkware.junk-king.com/franchise/accounting/truck-records.aspx" target="_blank" rel="noreferrer">Review reported expense</a> : 'Review receipt'}</span>
    </article>)}</div>
    {!data.rows.length && <p>No fuel entries in the available source detail for this date.</p>}
    <footer>Matches use truck, purchase date, and receipt or merchant and time. Published expenses retain their source authority.</footer>
  </section>;
}
