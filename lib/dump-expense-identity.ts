import {createHash} from 'node:crypto';
import type {TruckExpense} from './truck-expense-notifications';

export const canonicalDumpLocation = (name: string) => /^(?:gentill[yt]|gentilly landfill|gl)$/i.test(name.trim()) ? 'Gentilly' : name;
export type DumpAllocation = {marketTotal: number | null; table: string; tableTotal: number; unique: boolean};
const cents = (amount: number) => Math.round(amount * 100);
const identity = (row: TruckExpense) => JSON.stringify([row.date,row.truck,Date.parse(row.transactionAt),row.kind,row.receipt.trim(),(row.kind==='dump'?canonicalDumpLocation(row.location):row.location).trim().toLowerCase()]);
export function dumpAllocation(rows: TruckExpense[], value: unknown, kind: 'dump' | 'fuel' = 'dump'): DumpAllocation {
  const dump = rows.filter(row=>row.kind===kind);
  const raw = String(value ?? '').trim();
  const marketTotal = raw === '--' ? 0 : /^\$?\s*\d[\d,]*(?:\.\d{1,2})?$/.test(raw) ? cents(Number(raw.replace(/[$,\s]/g,''))) : null;
  return {marketTotal,table:JSON.stringify(dump.map(row=>[identity(row),cents(row.amount)])),
    tableTotal:dump.reduce((sum,row)=>sum+cents(row.amount),0),unique:new Set(dump.map(identity)).size===dump.length};
}
/** Market summary allocations can show the same full truck detail. Collapse only
 * when the complete tables agree and their allocation totals prove one expense. */
function consolidateKind(entries: TruckExpense[],kind: 'dump' | 'fuel'): TruckExpense[] {
  const field=kind==='dump'?'dumpAllocation':'fuelAllocation';
  const output: TruckExpense[] = [], consumed = new Set<string>();
  const groups = new Map<string,TruckExpense[]>();
  for (const entry of entries.filter(row=>row.kind===kind)) {
    const key=JSON.stringify([entry.date,entry.truck,entry[field]?.table]);
    groups.set(key,[...(groups.get(key)||[]),entry]);
  }
  for (const rows of groups.values()) {
    const markets = new Map(rows.map(row=>[row.market,row[field]]));
    const metadata=[...markets.values()];
    if (markets.size < 2 || metadata.some(item=>!item?.unique || item.marketTotal===null)
      || metadata.reduce((sum,item)=>sum+item!.marketTotal!,0)!==metadata[0]!.tableTotal) continue;
    const physical=new Map<string,TruckExpense[]>();
    for (const row of rows) physical.set(identity(row),[...(physical.get(identity(row))||[]),row]);
    if ([...physical.values()].some(copies=>copies.length!==markets.size || new Set(copies.map(row=>row.market)).size!==copies.length)) continue;
    for (const [key,copies] of physical) {
      const ordered=copies.slice().sort((a,b)=>a.id.localeCompare(b.id));
      const row=ordered[0];
      output.push({...row,id:createHash('sha256').update(`physical-${kind}:${key}`).digest('hex').slice(0,32),
        location:kind==='dump'?canonicalDumpLocation(row.location):row.location,sourceLocation:row.location,sourceExpenseIds:ordered.map(copy=>copy.id),sourceMarkets:[...markets.keys()].sort()});
      for (const copy of copies) consumed.add(copy.id);
    }
  }
  output.push(...entries.filter(row=>!consumed.has(row.id)).map(row=>row.kind===kind ? {...row,location:kind==='dump'?canonicalDumpLocation(row.location):row.location,sourceLocation:row.location} : row));
  const duplicates=new Map<string,TruckExpense[]>();
  for (const row of output.filter(row=>row.kind===kind)) duplicates.set(identity(row),[...(duplicates.get(identity(row))||[]),row]);
  for (const rows of duplicates.values()) if(rows.length>1) for(const row of rows) row.reconciliationNote='Possible duplicate source expenses; review the source records before counting this cost.';
  return output;
}

export const consolidateOperationalDumpExpenses=(entries:TruckExpense[])=>consolidateKind(consolidateKind(entries,'dump'),'fuel');
