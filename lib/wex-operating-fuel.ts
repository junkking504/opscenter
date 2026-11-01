import type { WexAlertDailyExpenses, WexAlertExpenseRow } from './wex-alert-expenses';
import { readWexAlertExpenses } from './wex-alert-expenses';
import { readWexFuelFinance, type WexFuelFinanceData } from './wex-fuel';
import { readOperationalTruckExpenses, expenseFingerprint, type TruckExpense } from './truck-expense-notifications';
import type { OperationalAlert } from './operational-alert-presentation';

import type { OperatingFuel } from '../desktop-ui/lib/wex-alert-expenses-contract';
export type { OperatingFuel } from '../desktop-ui/lib/wex-alert-expenses-contract';
const cents=(n:number)=>Math.round(n*100);
const normal=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
const truck=(s:string|null)=>s?.match(/\d+/)?.[0] || null;
const usable=(row:WexAlertExpenseRow)=>row.status==='provisional'||row.status==='posted';
function sameStationOverlap(row:WexAlertExpenseRow,report:TruckExpense){
  if(row.date!==report.date || report.kind!=='fuel')return false;
  const a=normal(row.merchant), b=normal(report.sourceLocation || report.location);
  if(a.length<4 || b.length<4 || !(a.startsWith(b)||b.startsWith(a)))return false;
  // Unknown time/truck cannot prove a distinct purchase. Keep a same-station
  // report as a possible overlap, without guessing which truck made it.
  return !row.attribution?.at || Math.abs(Date.parse(row.attribution.at)-Date.parse(report.transactionAt))<=30*60000;
}
function possibleReportOverlap(row:WexAlertExpenseRow,report:TruckExpense){
  if(sameStationOverlap(row,report))return true;
  if(row.date!==report.date || report.kind!=='fuel')return false;
  // Merchant labels can differ between a card processor and a crew entry.
  // Equal cents plus nearby evidence is a review candidate, never identity.
  const amount=row.postedAmount??row.authorizedAmount;
  if(amount===null || !Number.isFinite(amount) || cents(amount)!==cents(report.amount))return false;
  if(truck(row.truck)&&truck(report.truck)&&truck(row.truck)!==truck(report.truck))return false;
  // Receipt time is only a conservative fallback for overlap detection. It
  // must not assign a truck, infer the authorization timezone, or create a match.
  const at=Date.parse(row.attribution?.at || row.receivedAt), reportedAt=Date.parse(report.transactionAt);
  return Number.isFinite(at)&&Number.isFinite(reportedAt)&&Math.abs(at-reportedAt)<=30*60000;
}
export function alertMatchesReport(row:WexAlertExpenseRow,report:TruckExpense){
  return !!row.truck && truck(row.truck)===truck(report.truck) && !!row.attribution?.at && sameStationOverlap(row,report);
}

/** Reconcile identities before adding costs. When published fuel cannot be
 * explained by verified detail, expose overlap and use a floor rather than
 * silently adding a second copy of an unknown aggregate. */
export function reconcileOperatingFuel(published:number|null,wex:WexFuelFinanceData,alerts:WexAlertDailyExpenses,reports:TruckExpense[]):OperatingFuel{
  published=published==null||!Number.isFinite(Number(published))?null:Number(published);
  const rows=alerts.status==='available'?alerts.rows.filter(usable):[];
  const entries=reports.filter(row=>row.date===alerts.date&&row.kind==='fuel');
  const options=rows.map(row=>entries.filter(report=>alertMatchesReport(row,report)));
  const potential=rows.map(row=>entries.filter(report=>possibleReportOverlap(row,report)));
  const matched=new Set<string>();
  rows.forEach((_,index)=>{if(options[index].length===1 && potential.filter(list=>list.some(r=>r.id===options[index][0].id)).length===1)matched.add(options[index][0].id);});
  const linked=new Set(rows.flatMap(row=>row.postedId?[row.postedId]:[]));
  const posted=wex.available?wex.transactions.filter(p=>p.transactionDate===alerts.date&&!linked.has(p.transactionId)):[];
  const unknownPosted=posted.some(p=>p.totalFuelCost===null&&p.totalNonFuelCost!==0);
  const rowCents=(row:WexAlertExpenseRow)=>cents(row.postedAmount??row.authorizedAmount??0);
  const emailAmount=rows.reduce((sum,row)=>sum+rowCents(row),0)/100;
  const purchaseAmount=emailAmount+posted.reduce((sum,p)=>sum+cents(p.totalFuelCost??(p.totalNonFuelCost===0?p.netCost:0)),0)/100;
  const reported=entries.reduce((sum,row)=>sum+cents(row.amount),0)/100;
  // Complete individual detail is needed to add an unrelated purchase to a
  // nonzero published aggregate. An unmatched posted purchase may also overlap.
  const entriesClean=entries.every(r=>r.fuelAllocation?.unique!==false&&!r.reconciliationNote) && new Set(entries.map(r=>r.id)).size===entries.length;
  const detailComplete=published!==null && Math.abs(reported-published)<.005 && entriesClean;
  // Pair each unconfirmed WEX row with at most one manual entry (and each entry
  // with at most one row). A review pair is counted once, at the larger of its
  // two amounts; every WEX row or manual entry outside a pair stays counted.
  // Pairing only shapes the provisional total: it never links, edits or hides
  // either source record and never becomes a confirmed match.
  const confirmedRow=rows.map((_,i)=>options[i].length===1&&matched.has(options[i][0].id));
  const reviewPairs=pairCandidates(rows.map((_,i)=>confirmedRow[i]?[]:potential[i].filter(r=>!matched.has(r.id)).map(r=>r.id)));
  const pairCredit=reviewPairs.reduce((sum,[i,id])=>sum+Math.min(rowCents(rows[i]),cents(entries.find(r=>r.id===id)!.amount)),0)/100;
  const matchedAmount=entries.filter(r=>matched.has(r.id)).reduce((sum,r)=>sum+cents(r.amount),0)/100;
  const overlapUnresolved=alerts.status==='invalid' || alerts.rows.some(row=>row.status==='review') || unknownPosted || rows.some((_,i)=>potential[i].length>0&&!confirmedRow[i]) || (published!==null&&published>0&&(!detailComplete||posted.length>0));
  let amount=published;
  if(rows.length || posted.length){
    const blocked=alerts.status==='invalid' || alerts.rows.some(row=>row.status==='review') || unknownPosted || (published!==null&&published>0&&posted.length>0);
    if(detailComplete && !blocked) amount=(published??0)-matchedAmount-pairCredit+purchaseAmount;
    else {
      // Floor: published spend, all WEX purchases, and (with clean itemized
      // detail) manual entries plus WEX email rows less pairwise overlap.
      // Unlinked posted rows are not paired, so they never stack on entries.
      const itemized=published!==null&&entriesClean ? reported+emailAmount-matchedAmount-pairCredit : 0;
      amount=Math.max(published??0,purchaseAmount,itemized);
    }
  }
  return {amount:amount===null?null:cents(amount)/100,adjustment:amount===null?0:cents(amount-(published??0))/100,purchases:rows.length+posted.length,emailAmount,overlapUnresolved,publishedIncluded:amount!==null&&amount>purchaseAmount+.005,sourceAt:alerts.rows.filter(r=>usable(r)||r.status==='review').map(r=>r.receivedAt).sort().at(-1)||null,matchedReportIds:[...matched],
    reviewPairs:reviewPairs.map(([i,reportId])=>({wexId:rows[i].id,reportId}))};
}
/** Maximum one-to-one pairing (augmenting paths); candidates are tiny per day. */
function pairCandidates(candidates:string[][]):Array<[number,string]>{
  const owner=new Map<string,number>();
  const assign=(i:number,seen:Set<string>):boolean=>{
    for(const id of candidates[i]){
      if(seen.has(id))continue;seen.add(id);
      const holder=owner.get(id);
      if(holder===undefined||assign(holder,seen)){owner.set(id,i);return true;}
    }
    return false;
  };
  candidates.forEach((_,i)=>assign(i,new Set()));
  return [...owner].map(([id,i])=>[i,id] as [number,string]).sort((a,b)=>a[0]-b[0]);
}
export function readOperatingFuel(date:string,published:number|null,wex=readWexFuelFinance(date),alerts=readWexAlertExpenses(date,wex.transactions)){
  return reconcileOperatingFuel(published,wex,alerts,readOperationalTruckExpenses(date));
}

/** This is an internal timeline projection, not an external notification sender.
 * Stable purchase IDs retain acknowledgement state across revisions/settlement. */
export function wexRefuelingAlerts(data:WexAlertDailyExpenses,reports:TruckExpense[]=[]):OperationalAlert[]{
  if(data.status!=='available')return [];
  return data.rows.filter(usable).map(row=>{
    const at=row.attribution?.at || row.receivedAt;
    const amount=row.postedAmount??row.authorizedAmount;
    const clock=new Date(at).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'});
    const matches=reports.filter(report=>alertMatchesReport(row,report));
    return {id:row.id,eventFingerprint:row.id,source:'WEX email',timestamp:at,updatedAt:row.receivedAt,
      sourceMessageIds:[...row.sourceIds,...(matches.length===1?[expenseFingerprint(matches[0])]:[])],
      label:row.truck?'Refueled':'Fuel purchase · assign truck',domain:'Fleet',owner:'Fleet',truck:row.truck||undefined,detected:clock,
      title:row.truck?`${row.truck.replace('Truck# ', 'Truck #')} just refueled`:'Fuel purchase received · truck unassigned',needsAction:!row.truck,
      facts:[{label:'Amount',value:amount===null?'Unavailable':`$${amount.toFixed(2)}`},{label:'Station',value:[row.merchant,row.address].filter(Boolean).join(' · ')},{label:'Purchase time',value:`${clock} CT${row.attribution?.at?' · inferred':' · email received'}`},{label:'Evidence',value:row.attribution?.evidence||'GPS assignment unavailable'}],
      next:row.truck?'Recorded WEX fuel purchase; settlement updates this purchase.':'Expense included; review station/time GPS evidence to assign a truck.',
      href:`/desktop?workspace=Finance&financeView=expenses&date=${data.date}#wex-alert-expenses`};
  });
}
