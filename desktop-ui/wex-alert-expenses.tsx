import type {WexAlertDailyExpenses} from './lib/wex-alert-expenses-contract';
import {commercialMoney as money} from './lib/commercial-contract';
const labels={provisional:'Provisional authorization',posted:'Reconciled to posted purchase',reversed:'Reversed authorization',declined:'Declined authorization',review:'Review evidence'};
export function WexAlertExpenses({data}:{data?:WexAlertDailyExpenses}){
 if(!data)return null;
 return <section className="finance-cost-shell" id="wex-alert-expenses" aria-label="WEX daily alert records">
  <div className="section-title"><div><span className="section-kicker">{data.date} · Authorization evidence</span><h2>WEX daily alert records</h2><p>Pending fuel authorizations appear here before settlement. They are not added to published expenses or posted fuel totals.</p></div></div>
  {data.status!=='available'?<p role="status">{data.status==='invalid'?'Saved alert records need recovery.':'No WEX alert batch has been imported for daily records.'}</p>:<>
   <div className="capital-inline-totals"><div><span>Provisional authorizations</span><strong>{money(data.provisionalTotal)}</strong></div><div><span>Reconciled to posted</span><strong>{data.postedCount}</strong></div><div><span>Needs review</span><strong>{data.reviewCount}</strong></div></div>
   <p>{data.importedAt?`Alert batch imported ${new Date(data.importedAt).toLocaleString('en-US',{timeZone:'America/Chicago'})} CT. `:''}Import time is not evidence of an ongoing feed. A pending authorization may already be included in published fuel; these totals must not be added together.</p>
   <div className="finance-cost-list">{data.rows.map(row=><article key={row.id}><div><strong>{row.truck||'Truck unconfirmed'} · {row.merchant||'Merchant not recorded'}</strong><small>{labels[row.status]} · Tracking {row.trackingNumber}</small><small>Authorized {money(row.authorizedAmount)}{row.postedId?` · Posted fuel ${money(row.postedAmount)} · Transaction ${row.postedId}`:''}{row.difference!==null?` · Change ${money(row.difference)}`:''}</small><small>{row.authorizationLocal} · Authorization timezone unconfirmed</small><small>Received {row.receivedAt} · {row.revisionCount} source message{row.revisionCount===1?'':'s'}</small><small>{row.reason}</small></div><span><a href={row.sourceUrl} target="_blank" rel="noreferrer">Source alert</a></span></article>)}</div>
   {!data.rows.length&&<p>No imported alerts with this stated authorization date. This does not establish zero fuel spend.</p>}
  </>}
 </section>;
}
