import type { FinancialStatement } from './financial-statements';

export function accountingTrendRows(records: FinancialStatement[], selected: FinancialStatement) {
  return Array.from({ length: 12 }, (_, index) => {
    const at = new Date(`${selected.month}-01T12:00:00Z`); at.setUTCMonth(at.getUTCMonth() + index - 11);
    const month = at.toISOString().slice(0, 7);
    const lastDay = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const record = month === selected.month ? selected : records.find(row => row.month === month);
    const usable = record && record.company === selected.company && record.sourceKind === selected.sourceKind && record.basis !== 'Unspecified' && record.basis === selected.basis && record.periodEnd === lastDay;
    return { month, income: usable ? record.totals.income / 100 : null,
      expenses: usable ? (record.totals.cogs + record.totals.expenses + record.totals.otherExpenses) / 100 : null,
      netIncome: usable ? record.totals.netIncome / 100 : null,
      status: !record ? 'Missing statement' : usable ? 'Full month' : 'Partial month or incompatible basis' };
  });
}
