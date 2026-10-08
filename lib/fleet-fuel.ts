import type { TruckInspectionReport } from './truck-inspection';
import { normalizeTruckLoadLabel } from './truck-load-status';
import { chicagoDateKey } from './chicago-date';
import { readOperationalTruckExpenses } from './truck-expense-notifications';
import { readWexFuelFinance } from './wex-fuel';
import { readWexExpenseAutomation } from './wex-expense-automation';

export type FuelEvent = { truck: string; at: string; percent: number; source: 'inspection' | 'purchase'; detail: string };
export const inspectionLevelPercent = (value: string | undefined): number | null =>
  ({ Empty: 0, '1/4': 25, '1/2': 50, '3/4': 75, Full: 100 }[value || ''] ?? null);

/** Latest dated evidence wins. A purchase means full by the fleet's explicit policy,
 * not a sensor reading. Never extrapolate consumption or carry yesterday's level. */
export function fleetFuelLevel(date: string, truck: string, reports: TruckInspectionReport[], purchases: FuelEvent[], now = Date.now()) {
  const events: FuelEvent[] = reports.flatMap(report => {
    const percent = inspectionLevelPercent(report.fuel);
    return percent === null ? [] : [{ truck: report.truck, at: report.startedAt, percent, source: 'inspection' as const, detail: 'Reported at inspection' }];
  });
  events.push(...purchases);
  return events.filter(event => normalizeTruckLoadLabel(event.truck) === normalizeTruckLoadLabel(truck)
    && Number.isFinite(Date.parse(event.at)) && Date.parse(event.at) <= now
    && chicagoDateKey(new Date(event.at)) === date)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || Number(a.source === 'purchase') - Number(b.source === 'purchase'))[0] || null;
}

/** Existing local records only; no provider requests or automatic business writes. */
export function readFleetFuelPurchases(date: string): FuelEvent[] {
  const events: FuelEvent[] = readOperationalTruckExpenses(date)
    .filter(row => row.kind === 'fuel' && row.amount > 0 && row.fuelAllocation?.unique !== false && !row.reconciliationNote)
    .map(row => ({ truck: row.truck, at: row.transactionAt, percent: 100, source: 'purchase', detail: `Assumed full after fuel purchase${row.location ? ` · ${row.location}` : ''}` }));
  for (const purchase of readWexFuelFinance(date).transactions.filter(row => row.transactionDate === date && (row.gallons ?? 0) > 0 && row.netCost > 0)) {
    const saved = readWexExpenseAutomation(purchase.transactionId);
    if (saved?.attribution.status !== 'attributed' || !saved.attribution.truck) continue;
    events.push({ truck: saved.attribution.truck, at: saved.attribution.transactionAt, percent: 100, source: 'purchase', detail: `Assumed full after fuel purchase · ${purchase.merchant || 'WEX'}` });
  }
  return events;
}
