import type { FuelReconciliation, FuelReconciliationRow } from '../desktop-ui/lib/fuel-reconciliation-contract';
import { readOperationalTruckExpenses, type TruckExpense } from './truck-expense-notifications';
import { readWexFuelFinance, type WexFuelFinanceData, type WexFuelTransaction } from './wex-fuel';

const truckKey = (value: string) => value.trim().match(/^(?:Truck\s*#?\s*)?0*(\d+)$/i)?.[1] || null;
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const cents = (value: number) => Math.round(value * 100);
const fuelAmount = (row: WexFuelTransaction) => row.totalFuelCost ?? (row.totalNonFuelCost === 0 ? row.netCost : null);
function minutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]); const minute = Number(match[2]);
  if (minute > 59 || hour > (match[3] ? 12 : 23) || (match[3] && hour < 1)) return null;
  if (match[3]) hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  return hour * 60 + minute;
}
function reportMinutes(value: string): number | null {
  if (!Number.isFinite(Date.parse(value))) return null;
  return minutes(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)));
}
function related(wex: WexFuelTransaction, reported: TruckExpense) {
  if (!truckKey(wex.truck) || truckKey(wex.truck) !== truckKey(reported.truck) || wex.transactionDate !== reported.date) return false;
  const receipt = normalized(reported.receipt), ticket = normalized(wex.ticketNumber);
  // A source receipt identifies a purchase; totals alone never do.
  if (receipt && ticket && receipt === ticket) return true;
  const merchant = normalized(wex.merchant), location = normalized(reported.location);
  const sameMerchant = merchant.length >= 4 && location.length >= 4 && (merchant === location || merchant.startsWith(location) || location.startsWith(merchant));
  const a = minutes(wex.transactionTime), b = reportMinutes(reported.transactionAt);
  return Boolean(sameMerchant && a !== null && b !== null && Math.abs(a - b) <= 30);
}

export function reconcileFuel(date: string, wex: WexFuelFinanceData, entries: TruckExpense[]): FuelReconciliation {
  const reports = entries.filter(row => row.kind === 'fuel' && row.date === date);
  const reportIdentity = (row: TruckExpense) => JSON.stringify([truckKey(row.truck), row.date, row.transactionAt, normalized(row.location), normalized(row.receipt), cents(row.amount)]);
  const repeated = new Set(reports.filter(row => reports.some(other => other.id !== row.id && reportIdentity(other) === reportIdentity(row))).map(row => row.id));
  const purchases = wex.available ? wex.transactions.filter(row => row.transactionDate === date) : [];
  const candidates = purchases.map(purchase => reports.flatMap((report, index) => related(purchase, report) ? [index] : []));
  const reportCandidates = reports.map((_, index) => candidates.flatMap((matches, wexIndex) => matches.includes(index) ? [wexIndex] : []));
  const consumed = new Set<number>();
  const rows: FuelReconciliationRow[] = purchases.map((purchase, index) => {
    const options = candidates[index];
    const matchIndex = options.length === 1 && reportCandidates[options[0]].length === 1 && !repeated.has(reports[options[0]].id) ? options[0] : null;
    const report = matchIndex === null ? null : reports[matchIndex];
    if (matchIndex !== null) consumed.add(matchIndex);
    const amount = fuelAmount(purchase);
    const difference = report && amount !== null ? (cents(amount) - cents(report.amount)) / 100 : null;
    const ambiguous = options.length > 0;
    const status = report ? amount === null ? 'ambiguous' : difference === 0 ? 'matched' : 'amount_difference' : ambiguous ? 'ambiguous' : 'wex_only';
    return {
      id: `wex:${purchase.transactionId}`, truck: purchase.truck, date, location: purchase.merchant,
      status, reportedId: report?.id || null, wexId: purchase.transactionId,
      reportedAmount: report?.amount ?? null, wexFuelAmount: amount, wexNetAmount: purchase.netCost, difference,
      reason: report ? amount === null ? 'WEX fuel portion is unavailable; review the purchase.' : difference === 0 ? 'One reported expense matches this WEX purchase.' : 'Matched purchase has different fuel amounts; review both sources.'
        : ambiguous ? 'Multiple possible matches; no automatic reconciliation.' : 'No matching reported expense in the available JunkWare detail. Check reporting coverage and the receipt.',
    };
  });
  reports.forEach((report, index) => {
    if (consumed.has(index)) return;
    const ambiguous = reportCandidates[index].length > 0 || repeated.has(report.id);
    rows.push({ id: `reported:${report.id}`, truck: report.truck.replace('#', ''), date, location: report.location,
      status: ambiguous ? 'ambiguous' : 'awaiting_wex', reportedId: report.id, wexId: null,
      reportedAmount: report.amount, wexFuelAmount: null, wexNetAmount: null, difference: null,
      reason: repeated.has(report.id) ? `Possible duplicate reported entry (market ${report.market}); verify the source before counting it.` : ambiguous ? 'Multiple possible matches; review the source receipts.' : wex.available ? 'Awaiting a matching posted WEX purchase. Posting delays, other payment methods, or incomplete coverage may explain this.' : 'WEX source unavailable; this reported expense remains unreconciled.',
    });
  });
  return { date, wexAvailable: wex.available, wexImportedAt: wex.importedAt, rows,
    matchedCount: rows.filter(row => row.status === 'matched').length,
    differenceCount: rows.filter(row => row.status === 'amount_difference').length,
    reportedTotal: repeated.size ? null : reports.reduce((sum, row) => sum + cents(row.amount), 0) / 100,
    wexFuelTotal: !wex.available || purchases.some(row => fuelAmount(row) === null) ? null : purchases.reduce((sum, row) => sum + cents(fuelAmount(row)!), 0) / 100,
  };
}

export function readFuelReconciliation(date: string, wex = readWexFuelFinance(date)) {
  return reconcileFuel(date, wex, readOperationalTruckExpenses(date));
}
