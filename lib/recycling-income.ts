type RecordData = Record<string, any>;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const round = (value: number) => Math.round(value * 100) / 100;
const equal = (a: number, b: number) => Math.abs(a - b) < 0.011;

/** Adapt the legacy OpsBot Truck Records calculation without rewriting source files.
 * Metal yard proceeds were included in other_expense and subtracted from net.
 * Job sales and royalties retain their original basis; recycling is separate income.
 */
export function normalizeRecyclingIncome(metrics: RecordData | null): RecordData | null {
  if (!metrics || metrics.recycling_classification === 'income-v1' || finite(metrics.recycling_income)) return metrics;
  const rows = metrics.truck_record_financial_rows;
  if (!Array.isArray(rows) || !rows.length) return metrics;
  // Only adjust the proven legacy shape, never infer costs from incomplete records.
  if (!rows.every(row => ['recycling_expense', 'other_charge', 'other_expense', 'dump_expense', 'fuel_expense', 'total_expenses'].every(key => finite(row[key]))
    && equal(row.other_expense, row.other_charge + row.recycling_expense)
    && equal(row.total_expenses, row.dump_expense + row.fuel_expense + row.other_expense))) return metrics;
  const income = round(rows.reduce((sum, row) => sum + row.recycling_expense, 0));
  const oldOther = round(rows.reduce((sum, row) => sum + row.other_expense, 0));
  const oldCosts = round(rows.reduce((sum, row) => sum + row.total_expenses, 0));
  const adjust = (source: RecordData, costs: string[], profits: string[]) => {
    const result: RecordData = { ...source, recycling_income: income };
    for (const key of costs) if (finite(source[key])) result[key] = round(source[key] - income);
    for (const key of profits) if (finite(source[key])) result[key] = round(source[key] + 2 * income);
    return result;
  };
  const summary = (source: RecordData): RecordData => {
    if (!finite(source.other_expense) || !equal(source.other_expense, oldOther)) return { ...source, recycling_income: income };
    const result = adjust(source, ['other_expense', 'total_expenses'], ['net_profit']);
    if (finite(result.net_profit) && finite(source.sales)) result.net_margin = source.sales > 0 ? round(result.net_profit / source.sales * 100) : null;
    return result;
  };
  let result = summary(metrics);
  if (finite(metrics.truck_record_operating_expenses) && equal(metrics.truck_record_operating_expenses, oldCosts)) {
    result = adjust(result, ['truck_record_operating_expenses'], ['net_after_truck_expenses', 'net_after_truck_expenses_and_cc_fees', 'net_revenue']);
  }
  result.truck_record_financial_rows = rows.map(row => {
    const value = row.recycling_expense;
    const costs = round(row.total_expenses - value);
    return { ...row, recycling_income: value, other_expense: row.other_charge, combined_other_expense: row.other_charge, total_expenses: costs,
      ...(finite(row.net_before_payroll_and_royalties) ? { net_before_payroll_and_royalties: round(row.net_before_payroll_and_royalties + 2 * value) } : {}),
      ...(finite(row.sales) ? { expense_percent: row.sales > 0 ? round(costs / row.sales * 100) : 0 } : {}) };
  });
  if (metrics.truck_record_financial_summary) result.truck_record_financial_summary = summary(metrics.truck_record_financial_summary);
  if (Array.isArray(metrics.truck_daily_financials)) result.truck_daily_financials = metrics.truck_daily_financials.map((row: RecordData) => {
    if (!['recycling', 'other', 'other_expense', 'total_expenses'].every(key => finite(row[key])) || !equal(row.other_expense, row.other + row.recycling)) return row;
    const costs = round(row.total_expenses - row.recycling);
    return { ...row, recycling_income: row.recycling, other_expense: row.other, total_expenses: costs,
      ...(finite(row.net_after_expenses) ? { net_after_expenses: round(row.net_after_expenses + 2 * row.recycling) } : {}),
      ...(finite(row.sales) ? { expense_percent: row.sales > 0 ? round(costs / row.sales * 100) : 0 } : {}) };
  });
  if (metrics.expenses_by_truck) result.expenses_by_truck = Object.fromEntries(Object.entries(metrics.expenses_by_truck).map(([truck, value]) => {
    const row = value as RecordData;
    return [truck, finite(row.recycling) && finite(row.total) ? { ...row, recycling_income: row.recycling, total: round(row.total - row.recycling) } : row];
  }));
  return { ...result, recycling_classification: 'income-v1' };
}
