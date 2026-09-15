import type { AnyRecord } from '@/lib/opsData';
import type { WexFuelFinanceData } from '@/lib/wex-fuel';

export type DailyFinanceSummary = {
  revenue: number | null;
  labor: number | null;
  dumps: number | null;
  fuel: number | null;
  totalCosts: number | null;
  net: number | null;
  fuelSource: 'published' | 'wex' | 'unavailable';
  wexIncludedSeparately: boolean;
};

const finite = (value: unknown): number | null => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const round = (value: number) => Number(value.toFixed(2));
const record = (value: unknown): AnyRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {};

/**
 * Build the selected-day financial headline from one published metrics read.
 * A posted WEX total fills a missing/zero published fuel field, but is never
 * added again when the published daily metrics already contain fuel expense.
 */
export function buildDailyFinanceSummary(metrics: AnyRecord | null, wex?: WexFuelFinanceData): DailyFinanceSummary {
  const published = record(metrics?.truck_record_financial_summary);
  const publishedFuel = finite(metrics?.fuel_expense ?? published.fuel_expense);
  const hasWexFuel = Boolean(wex?.available && wex.selectedDate.count > 0);
  const wexIncludedSeparately = hasWexFuel && (publishedFuel == null || Math.abs(publishedFuel) < 0.005);
  const wexCost = wexIncludedSeparately ? wex!.selectedDate.netCost : 0;
  const totalCosts = finite(metrics?.total_expenses ?? published.total_expenses);
  const net = finite(metrics?.net_profit ?? published.net_profit);

  return {
    revenue: finite(metrics?.sales ?? published.sales ?? metrics?.total_revenue ?? metrics?.gross_revenue),
    labor: finite(metrics?.total_payroll ?? metrics?.payroll ?? published.payroll),
    dumps: finite(metrics?.dump_expense ?? published.dump_expense),
    fuel: wexIncludedSeparately ? wex!.selectedDate.netCost : publishedFuel,
    totalCosts: totalCosts == null ? null : round(totalCosts + wexCost),
    net: net == null ? null : round(net - wexCost),
    fuelSource: wexIncludedSeparately ? 'wex' : publishedFuel == null ? 'unavailable' : 'published',
    wexIncludedSeparately,
  };
}
