export const statementMetrics = [
  ['income', 'Income'], ['cogs', 'Cost of goods sold'], ['grossProfit', 'Gross profit'],
  ['expenses', 'Operating expenses'], ['operatingIncome', 'Operating income'],
  ['otherIncome', 'Other income'], ['otherExpenses', 'Other expenses'],
  ['netOtherIncome', 'Net other income'], ['netIncome', 'Net income'],
] as const;
export type StatementMetric = typeof statementMetrics[number][0];
export type StatementRow = { label: string; cents: number | null; cell: string; formula: string | null };
export type FinancialStatement = {
  id: string; sourceId: string; sourceKind: 'workbook' | 'qbo'; sourceName: string; sheet: string;
  company: string; month: string; reportThrough: string; basis: 'Accrual' | 'Cash' | 'Unspecified';
  status: 'Draft' | 'Unreviewed' | 'Current books'; periodEnd?: string; observedAt?: string; totals: Record<StatementMetric, number>; rows: StatementRow[];
  supplemental: StatementRow[]; annotations: Array<{ cell: string; text: string }>; warnings: string[];
};
export type StatementData = { available: boolean; error: string | null; importedAt: string | null; records: FinancialStatement[] };
export function preferredStatements(records: FinancialStatement[]): FinancialStatement[] {
  // A later reporting period can restate a comparative month. Keep all sources
  // available for inspection; never combine comparative and current columns.
  const selected = new Map<string, FinancialStatement>();
  for (const record of [...records].sort((a, b) => a.reportThrough.localeCompare(b.reportThrough) || a.sourceName.localeCompare(b.sourceName))) selected.set(`${record.company}:${record.month}`, record);
  return [...selected.values()].sort((a, b) => a.month.localeCompare(b.month));
}
export function statementYearCoverage(records: FinancialStatement[], month: string) {
  const year = month.slice(0, 4);
  const expected = Array.from({ length: Number(month.slice(5)) }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
  const selected = preferredStatements(records).filter(record => expected.includes(record.month));
  const missing = expected.filter(key => !selected.some(record => record.month === key));
  const comparable = new Set(selected.map(record => record.basis)).size === 1 && selected[0]?.basis !== 'Unspecified' && new Set(selected.map(record => record.company)).size === 1;
  return { missing, totals: !missing.length && comparable ? Object.fromEntries(statementMetrics.map(([key]) => [key, selected.reduce((sum, record) => sum + record.totals[key], 0)])) as Record<StatementMetric, number> : null };
}
