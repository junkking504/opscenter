import assert from 'node:assert/strict';
import { normalizeRecyclingIncome } from '../lib/recycling-income';

const row = { sales: 1000, recycling_expense: 100, other_charge: 20, other_expense: 120, combined_other_expense: 120,
  dump_expense: 50, fuel_expense: 30, total_expenses: 200, net_before_payroll_and_royalties: 800, expense_percent: 20 };
const summary = { sales: 1000, other_expense: 120, total_expenses: 430, net_profit: 570, net_margin: 57, payroll: 100, junk_king_royalties: 80, call_center_royalties: 50 };
const source = { ...summary, truck_record_financial_summary: { ...summary }, truck_record_financial_rows: [row],
  truck_record_operating_expenses: 200, net_after_truck_expenses: 800, net_after_truck_expenses_and_cc_fees: 770, net_revenue: 770,
  truck_daily_financials: [{ sales: 1000, recycling: 100, other: 20, other_expense: 120, total_expenses: 200, net_after_expenses: 800 }],
  expenses_by_truck: { truck: { recycling: 100, total: 200 } } };
const before = structuredClone(source);
const actual = normalizeRecyclingIncome(source)!;
assert.equal(actual.recycling_income, 100);
assert.equal(actual.other_expense, 20, 'Metal income is excluded from other costs');
assert.equal(actual.total_expenses, 330, 'Only operating costs remain');
assert.equal(actual.net_profit, 770, '1000 in job sales plus 100 in metal income less 330 in costs');
assert.equal(actual.sales, 1000, 'Do not inflate job sales or their royalty basis');
assert.equal(actual.junk_king_royalties, 80);
assert.equal(actual.net_margin, 77);
assert.equal(actual.truck_record_financial_summary.net_profit, 770);
assert.equal(actual.truck_record_financial_rows[0].total_expenses, 100);
assert.equal(actual.truck_record_financial_rows[0].net_before_payroll_and_royalties, 1000);
assert.equal(actual.truck_record_operating_expenses, 100);
assert.equal(actual.net_revenue, 970);
assert.equal(actual.truck_daily_financials[0].net_after_expenses, 1000);
assert.equal(actual.expenses_by_truck.truck.total, 100);
assert.deepEqual(source, before, 'Never rewrite or mutate the raw source');
assert.deepEqual(normalizeRecyclingIncome(actual), actual, 'Classification must be idempotent');
assert.deepEqual(normalizeRecyclingIncome({ ...source, recycling_income: 100 }), { ...source, recycling_income: 100 }, 'New source contract is already income');
assert.equal(normalizeRecyclingIncome(null), null);
const absent = { total_expenses: 45, net_profit: 100 };
assert.deepEqual(normalizeRecyclingIncome(absent), absent, 'Missing source evidence stays missing');
const incomplete = { ...source, truck_record_financial_rows: [{ ...row, recycling_expense: null }] };
assert.deepEqual(normalizeRecyclingIncome(incomplete), incomplete);
const incompatible = { ...source, truck_record_financial_rows: [{ ...row, other_expense: 20 }] };
assert.deepEqual(normalizeRecyclingIncome(incompatible), incompatible, 'Do not subtract recycling twice from a different source formula');
const zero = normalizeRecyclingIncome({ ...summary, other_expense: 20, truck_record_financial_rows: [{ ...row, recycling_expense: 0, other_expense: 20, total_expenses: 100 }] })!;
assert.equal(zero.recycling_income, 0, 'Published zero is distinct from unavailable');
assert.equal(zero.total_expenses, 430);
console.log('Recycling income: costs, profit, truck totals, source preservation, idempotency and missing evidence passed.');
