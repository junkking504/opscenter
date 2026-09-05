import { financePeriodComparison } from '@/lib/finance-period-comparison';
import fs from 'node:fs';
import path from 'node:path';
import { readMetrics, type AnyRecord } from '@/lib/opsData';
import { buildMonthlySummary, buildFinanceTrendSummary } from '@/lib/monthly-summary';
import { buildDailyPaymentReconciliation } from '@/lib/payment-reconciliation';
import { readResaleStore, upsertResaleItem, type ResaleItemInput } from '@/lib/resale-items';
import { commercialDirectory, commercialVersion, executeCommercialOperation, validCommercialDate, CommercialActionError } from '@/lib/desktop-marketing';
import type { InteractiveOpsRole } from '@/lib/ops-roles';
import type { CommercialOperation, FinanceData, RecyclingRecord } from '../desktop-ui/lib/commercial-contract';
const finite = (value: unknown): number | null => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const sumField = (entries: AnyRecord[], field: string): number | null => !entries.length || entries.some(entry => finite(entry[field]) == null) ? null : entries.reduce((sum, entry) => sum + Number(entry[field]), 0);
function recyclingFile() { return path.join(commercialDirectory(), 'recycling-store'); }
function readRecycling(): RecyclingRecord[] { try { const store = JSON.parse(fs.readFileSync(recyclingFile(), 'utf8')); if (store.schemaVersion !== 1 || !Array.isArray(store.records)) throw new CommercialActionError('Recycling store requires recovery.'); return store.records; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; } }
export function readDesktopFinance(date: string): FinanceData {
  const metrics = readMetrics(date);
  const monthly = buildMonthlySummary(date);
  const trend = buildFinanceTrendSummary(date);
  const resaleFile = path.join(process.cwd(), 'data', 'finance', 'resale_items.json');
  if (fs.existsSync(resaleFile)) { const payload = JSON.parse(fs.readFileSync(resaleFile, 'utf8')); if (payload.version !== 1 || !Array.isArray(payload.items)) throw new CommercialActionError('Resale source needs recovery.'); }
  const resale = readResaleStore();
  const recycling = readRecycling();
  const markets = [...new Set(monthly.entries.flatMap(entry => [...Object.keys(entry.metrics.revenue_by_market || {}), ...Object.keys(entry.metrics.jobs_by_market || {})]))];
  const marketSum = (territory: string, key: string) => { const values = monthly.entries.map(entry => finite(entry.metrics[key]?.[territory])); return values.every(value => value == null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0); };

  return { comparison:financePeriodComparison(monthly.range.dataThroughDate,readMetrics), date, available: Boolean(metrics), generatedAt: metrics?.generated_at || metrics?.updated_at || null,
    daily: { revenue: finite(metrics?.sales ?? metrics?.truck_record_financial_summary?.sales ?? metrics?.total_revenue ?? metrics?.gross_revenue), costs: finite(metrics?.total_expenses), profit: finite(metrics?.net_profit), recyclingExpense: finite(metrics?.recycling_expense ?? metrics?.truck_record_financial_summary?.recycling_expense) },
    month: { label: monthly.range.monthDisplay, through: monthly.range.dataThroughDate, complete: monthly.range.complete, missingDates: monthly.range.missingDates, revenue: monthly.entries.length || monthly.authority ? monthly.grossRevenue : null, jobs: monthly.entries.length || monthly.authority ? monthly.completedJobs : null, costs: sumField(monthly.entries.map(entry => entry.metrics), 'total_expenses'), profit: sumField(monthly.entries.map(entry => entry.metrics), 'net_profit'), source: monthly.revenueSource },
    territories: markets.map(territory => ({ territory, jobs: marketSum(territory, 'jobs_by_market'), revenue: marketSum(territory, 'revenue_by_market') })), costs: [['Payroll', 'total_payroll'], ['Dump Expense', 'dump_expense'], ['Fuel Expense', 'fuel_expense'], ['Recycling Expense', 'recycling_expense'], ['Other Expense', 'other_expense']].map(([category, key]) => ({ category, amount: sumField(monthly.entries.map(entry => entry.metrics), key), source: 'Published daily metrics' })),
    trends: trend.months.map(month => { const published = buildMonthlySummary(`${month.monthKey}-01`).entries.map(entry => entry.metrics); return { ...month, totalOperatingExpenses: sumField(published, 'total_expenses'), estimatedOperatingProfit: sumField(published, 'net_profit') }; }), reconciliation: buildDailyPaymentReconciliation(date), resale: resale.items.map(item => ({ ...item, version: commercialVersion(item) })), resaleUpdatedAt: resale.updatedAt || null,
    recycling, recyclingVersion: commercialVersion(recycling), recyclingExpenses: (Array.isArray(metrics?.truck_record_financial_rows) ? metrics.truck_record_financial_rows : []).map((row: AnyRecord) => ({ truck: String(row.truck || row.truck_name || 'Unassigned'), value: finite(row.recycling_expense) })).filter((row: { truck: string; value: number | null }): row is { truck: string; value: number } => row.value != null && row.value !== 0) };
}
function text(value: unknown, maximum = 500): string { if (typeof value !== 'string' || value.length > maximum) throw new CommercialActionError('A valid text value is required.'); return value.trim(); }
function amount(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000 || Math.abs(value * 100 - Math.round(value * 100)) > .0001) throw new CommercialActionError('Enter a nonnegative amount with at most two decimal places.'); return value; }
export function updateDesktopFinance(operation: CommercialOperation, actor: { email: string; role: InteractiveOpsRole }) {
  const values = operation.values;
  if (operation.action === 'resale.save') {
    const itemName = text(values.itemName), source = text(values.source), acquiredDate = text(values.acquiredDate), status = text(values.status) as ResaleItemInput['status'];
    if (!itemName || !source || !validCommercialDate(acquiredDate) || !['to_list', 'listed', 'sold'].includes(status)) throw new CommercialActionError('Item name, source, acquisition date, and valid status are required.');
    const item: ResaleItemInput = { itemId: operation.recordId, itemName, source, acquiredDate, status, cost: amount(values.cost), askingPrice: amount(values.askingPrice), soldPrice: amount(values.soldPrice), marketplace: text(values.marketplace), notes: text(values.notes, 2000) };
    if (status === 'listed' && !item.marketplace) throw new CommercialActionError('Enter the listing location.');
    if (status === 'sold' && !item.notes) throw new CommercialActionError('Record the sale receipt or evidence in notes.');
    return executeCommercialOperation(operation, actor, () => { const existing = readResaleStore().items.find(item => item.itemId === operation.recordId); return existing ? commercialVersion(existing) : commercialVersion([]); }, () => {
      const saved = upsertResaleItem(item); const actual = readResaleStore().items.find(entry => entry.itemId === operation.recordId);
      return Boolean(saved && actual && commercialVersion(saved) === commercialVersion(actual));
    });
  }
  if (operation.action !== 'recycling.save') throw new CommercialActionError('Unsupported Finance action. Payment matching remains source-authoritative.');
  const material = text(values.material), sourceJob = text(values.sourceJob), yard = text(values.yard), quantity = text(values.quantity), owner = text(values.owner), ticket = text(values.ticket), paymentReference = text(values.paymentReference), note = text(values.note, 2000), status = text(values.status) as RecyclingRecord['status'];
  if (!material || !sourceJob || !quantity || !owner || !['Awaiting yard', 'Submitted', 'Paid'].includes(status)) throw new CommercialActionError('Material, source job, quantity, owner, and valid status are required.');
  if (status !== 'Awaiting yard' && (!yard || !ticket)) throw new CommercialActionError('Yard and ticket reference are required.');
  if (status === 'Paid' && !paymentReference) throw new CommercialActionError('A recorded payment reference is required.');
  const expectedValue = values.expectedValue === null ? null : amount(values.expectedValue);
  const realizedValue = values.realizedValue === null ? null : amount(values.realizedValue);
  if (status === 'Paid' && realizedValue == null) throw new CommercialActionError('Enter the actual amount received.');
  return executeCommercialOperation(operation, actor, () => { const records = readRecycling(); return records.find(record => record.id === operation.recordId)?.version || commercialVersion(records); }, () => {
    const records = readRecycling(); const value = { id: operation.recordId, date: records.find(item => item.id === operation.recordId)?.date || operation.date, material, sourceJob, yard, quantity, owner, ticket, paymentReference, note, status, expectedValue, realizedValue, updatedAt: new Date().toISOString() };
    const record = { ...value, version: commercialVersion(value) };
    const next = records.filter(item => item.id !== record.id).concat(record);
    const file = recyclingFile(); fs.writeFileSync(`${file}.tmp`, JSON.stringify({ schemaVersion: 1, records: next }), { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file);
    return readRecycling().some(item => item.id === record.id && item.version === record.version);
  });
}
