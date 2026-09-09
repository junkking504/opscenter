import type { FinancialStatement, StatementMetric, StatementRow } from '../desktop-ui/lib/financial-statements';

type ColumnData = { value?: string };
type ReportRow = { group?: string; type?: string; ColData?: ColumnData[]; Header?: { ColData?: ColumnData[] }; Summary?: { ColData?: ColumnData[] }; Rows?: { Row?: ReportRow[] } };
type Report = { Header?: { ReportName?: string; ReportBasis?: string; Currency?: string; StartPeriod?: string; EndPeriod?: string; Time?: string; Option?: Array<{ Name: string; Value: string }> }; Columns?: { Column?: Array<{ MetaData?: Array<{ Name: string; Value: string }> }> }; Rows?: { Row?: ReportRow[] } };
const groups: Record<string, StatementMetric> = { Income: 'income', COGS: 'cogs', GrossProfit: 'grossProfit', Expenses: 'expenses', NetOperatingIncome: 'operatingIncome', OtherIncome: 'otherIncome', OtherExpenses: 'otherExpenses', NetOtherIncome: 'netOtherIncome', NetIncome: 'netIncome' };
export function qboMoneyCents(value: unknown): number | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^-?\d+(\.\d{1,2})?$/.test(value)) throw new Error('Invalid QBO monetary value.');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error('QBO amount exceeds supported precision.');
  return negative ? -amount : amount;
}
export function normalizeQboProfitAndLoss(payload: unknown, company: string, sourceId: string): FinancialStatement[] {
  const report = payload as Report;
  const header = report?.Header;
  if (header?.ReportName !== 'ProfitAndLoss' || header.ReportBasis !== 'Accrual' || header.Currency !== 'USD' || !header.StartPeriod || !header.EndPeriod || !header.Time || !Number.isFinite(Date.parse(header.Time))) throw new Error('QBO report identity, basis, currency or dates could not be verified.');
  if (header.Option?.some(o => o.Name === 'NoReportData' && o.Value === 'true')) throw new Error('QBO returned no report data.');
  const topRows = report.Rows?.Row;
  if (!Array.isArray(topRows)) throw new Error('QBO report rows are missing.');
  const columns = report.Columns?.Column;
  if (!Array.isArray(columns)) throw new Error('QBO report columns are missing.');
  const records: FinancialStatement[] = [];
  for (const [index, column] of columns.entries()) {
    const metadata = Object.fromEntries((column.MetaData || []).map(m => [m.Name, m.Value]));
    if (!metadata.StartDate || !metadata.EndDate) continue; // Account and grand total columns.
    const month = metadata.StartDate.slice(0, 7);
    if (!/^20\d{2}-(0[1-9]|1[0-2])-01$/.test(metadata.StartDate) || metadata.EndDate.slice(0, 7) !== month || metadata.StartDate < header.StartPeriod || metadata.EndDate > header.EndPeriod) throw new Error('Unexpected QBO monthly report period.');
    const totals = {} as FinancialStatement['totals'];
    for (const [group, key] of Object.entries(groups)) {
      const row = topRows.find(r => r.group === group);
      const amount = qboMoneyCents(row?.Summary?.ColData?.[index]?.value);
      if (amount === null) throw new Error(`QBO ${group} total is missing for ${month}.`);
      totals[key] = amount;
    }
    const rows: StatementRow[] = [];
    function visit(entries: ReportRow[], prefix: string) {
      entries.forEach((row, i) => {
        const ref = `${prefix}[${i}]`;
        for (const [kind, data] of [['Header', row.Header?.ColData], ['ColData', row.ColData]] as const) {
          if (data?.[0]?.value) rows.push({ label: data[0].value, cents: qboMoneyCents(data[index]?.value), cell: `${ref}.${kind}[${index}]`, formula: null });
        }
        if (row.Rows?.Row) visit(row.Rows.Row, `${ref}.Rows.Row`);
        if (row.Summary?.ColData?.[0]?.value) rows.push({ label: row.Summary.ColData[0].value, cents: qboMoneyCents(row.Summary.ColData[index]?.value), cell: `${ref}.Summary[${index}]`, formula: null });
      });
    }
    visit(topRows, 'Row');
    const warnings = ['Current QBO books may contain incomplete or unreconciled entries; this is not an accountant-approved month-end close.'];
    for (const [actual, expected] of [[totals.grossProfit, totals.income - totals.cogs], [totals.operatingIncome, totals.grossProfit - totals.expenses], [totals.netOtherIncome, totals.otherIncome - totals.otherExpenses], [totals.netIncome, totals.operatingIncome + totals.netOtherIncome]]) {
      if (Math.abs(actual - expected) > 1) throw new Error(`QBO report totals do not reconcile for ${month}.`);
    }
    records.push({ id: `${sourceId}:${month}`, sourceId, sourceKind: 'qbo', sourceName: `QuickBooks Online · ${month.slice(0, 4)} Accrual P&L`, company, month, reportThrough: header.EndPeriod.slice(0, 7), periodEnd: metadata.EndDate, observedAt: header.Time, basis: 'Accrual', status: 'Current books', sheet: 'ProfitAndLoss', totals, rows, supplemental: [], annotations: [], warnings });
  }
  if (!records.length || new Set(records.map(r => r.month)).size !== records.length) throw new Error('QBO report monthly coverage is invalid.');
  const totalColumn = columns.findIndex(c => c.MetaData?.some(m => m.Name === 'ColKey' && m.Value.toLowerCase() === 'total'));
  if (totalColumn < 0) throw new Error('QBO report grand total column is missing.');
  for (const [group, key] of Object.entries(groups)) {
    const expected = qboMoneyCents(topRows.find(r => r.group === group)?.Summary?.ColData?.[totalColumn]?.value);
    if (expected === null || Math.abs(records.reduce((sum, r) => sum + r.totals[key], 0) - expected) > 1) throw new Error('QBO monthly columns do not reconcile to report total.');
  }
  return records;
}
