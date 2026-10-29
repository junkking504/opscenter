import {readWexAlertDates,readWexAlertExpenses} from './wex-alert-expenses';
import {readWexFuelFinance} from './wex-fuel';
import {readOperationalTruckExpenses} from './truck-expense-notifications';
import {reconcileOperatingFuel,readOperatingFuel} from './wex-operating-fuel';
import type {OperatingTrendsData,OperatingDay} from './operating-trends';

/** Overlay retained email purchase evidence on completed-day charts on read.
 * No vendor polling, dataset rewrite, or invented zero-spend days. */
export function withWexEmailExpenses(data:OperatingTrendsData|null):OperatingTrendsData|null{
 if(!data)return null;
 const dates=readWexAlertDates().filter(date=>date<=data.historyThrough&&date>=data.daily[0]?.date);
 const daily=data.daily.map(row=>({...row}));
 const trucks=(data.trucks||[]).map(row=>({...row,daily:row.daily.map(day=>({...day}))}));
 for(const date of dates){
  const row=daily.find(row=>row.date===date);if(!row)continue;
  const wex=readWexFuelFinance(date),alerts=readWexAlertExpenses(date,wex.transactions);
  const fuel=readOperatingFuel(date,row.recordedFuel,wex,alerts);
  if(!fuel.purchases)continue;
  const oldSupplement=row.wexCost!==null&&(row.recordedFuel===null||Math.abs(row.recordedFuel)<.005)?row.wexCost:0;
  row.wexCost=fuel.amount;row.dumpAndFuel=row.dumpCost===null||fuel.amount===null?null:row.dumpCost+fuel.amount;
  if(row.operatingProfit!=null)row.operatingProfit=Math.round((row.operatingProfit+oldSupplement-fuel.adjustment)*100)/100;
  // Gallons and unit price stay export-only: mixing denominators would invent a price.
  row.netPerGallon=null;
  for(const purchase of alerts.rows.filter(p=>p.status==='provisional'&&p.truck)){
   const name=purchase.truck!.replace('#','').replace(/\s+/g,' ').trim();
   let truck=trucks.find(t=>t.truck.replace('#','').replace(/\s+/g,' ').trim()===name);
   if(!truck){truck={truck:name,daily:[]};trucks.push(truck);}
   let day=truck.daily.find(d=>d.date===date);
   if(!day){day={date,revenue:null,completedJobs:null,recordedFuel:null,wexCost:null,gallons:null,netPerGallon:null,dumpCost:null} satisfies OperatingDay;truck.daily.push(day);}
   // Full per-truck reconciliation is performed below, once per truck/day.
  }
  for(const truck of trucks){
   const key=truck.truck.match(/\d+/)?.[0];const day=truck.daily.find(d=>d.date===date);if(!day)continue;
   const subset={...alerts,rows:alerts.rows.filter(p=>p.truck?.match(/\d+/)?.[0]===key)};
   if(!subset.rows.length)continue;
   const posted={...wex,transactions:wex.transactions.filter(p=>subset.rows.some(a=>a.postedId===p.transactionId))};
   const result=reconcileOperatingFuel(day.recordedFuel,posted,subset,readOperationalTruckExpenses(date).filter(r=>r.truck.match(/\d+/)?.[0]===key));
   day.wexCost=result.amount;day.netPerGallon=null;
  }
 }
 const coverage=dates.length?{status:'partial' as const,records:dates.length,coverageFrom:dates[0],coverageThrough:dates.at(-1)!,updatedAt:null,note:'WEX email purchase expenses included by purchase day; GPS assigns trucks. Posted exports remain separate settlement evidence.'}:null;
 return {...data,daily,trucks,sourceCoverage:{...data.sourceCoverage,...(coverage?{wexEmail:coverage}:{})}};
}
