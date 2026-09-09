import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refreshQboFinancialStatements } from '../lib/qbo-financial-refresh';
import { normalizeQboProfitAndLoss, qboMoneyCents } from '../lib/qbo-financial-statements';
import { statementYearCoverage } from '../desktop-ui/lib/financial-statements';
const totals = { Income: 100, COGS: 30, GrossProfit: 70, Expenses: 50, NetOperatingIncome: 20, OtherIncome: 0, OtherExpenses: 25, NetOtherIncome: -25, NetIncome: -5 };
const report = {
  Header: { ReportName: 'ProfitAndLoss', ReportBasis: 'Accrual', Currency: 'USD', StartPeriod: '2026-01-01', EndPeriod: '2026-02-09', Time: '2026-02-09T12:00:00Z' },
  Columns: { Column: [{}, ...['01', '02'].map(month => ({ MetaData: [{ Name: 'StartDate', Value: `2026-${month}-01` }, { Name: 'EndDate', Value: `2026-${month}-${month === '01' ? '31' : '09'}` }] })), { MetaData: [{ Name: 'ColKey', Value: 'total' }] }] },
  Rows: { Row: Object.entries(totals).map(([group, value]) => ({ group, Summary: { ColData: [{ value: group }, { value: value.toFixed(2) }, { value: value.toFixed(2) }, { value: (value * 2).toFixed(2) }] } })) },
};
assert.equal(qboMoneyCents('-1.01'), -101);
assert.equal(qboMoneyCents('0.00'), 0);
assert.equal(qboMoneyCents(''), null);
assert.throws(() => qboMoneyCents('1,200.00'));
const records = normalizeQboProfitAndLoss(report, 'Synthetic Test Company', 'b'.repeat(64));
assert.equal(records.length, 2, 'Grand total must not be imported as a month.');
assert.equal(records[1].periodEnd, '2026-02-09', 'Retain partial month cutoff.');
assert.equal(records[1].totals.netIncome, -500);
assert.equal(statementYearCoverage(records, '2026-02').totals?.income, 20000);
assert.equal(records[0].sourceKind, 'qbo');
assert.throws(() => normalizeQboProfitAndLoss({ ...report, Header: { ...report.Header, ReportBasis: 'Cash' } }, 'Synthetic Test Company', 'b'.repeat(64)), /basis/);
const missing = structuredClone(report); missing.Rows.Row = missing.Rows.Row.filter(r => r.group !== 'NetIncome');
assert.throws(() => normalizeQboProfitAndLoss(missing, 'Synthetic Test Company', 'b'.repeat(64)), /total is missing/);
const broken = structuredClone(report); broken.Rows.Row.at(-1)!.Summary.ColData[1].value = '99.00';
assert.throws(() => normalizeQboProfitAndLoss(broken, 'Synthetic Test Company', 'b'.repeat(64)), /do not reconcile/);
console.log('PASS: QBO report identity, money precision, missing totals, partial dates, subtotal reconciliation, monthly/YTD aggregation. Synthetic only.');

async function verifyRefresh() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qbo-reports-test-'));
  let calls = 0;
  const provider = {
    readCompany: async () => { calls++; return { CompanyName: 'Synthetic Test Company', Id: '1' }; },
    readReport: async (start: string, end: string) => {
      calls++;
      const value = JSON.parse(JSON.stringify(report).replaceAll('2026', start.slice(0, 4)));
      value.Header.StartPeriod = start; value.Header.EndPeriod = end;
      return value;
    },
  };
  try {
    const first = await refreshQboFinancialStatements('2026-02-09', 'Synthetic Test Company', directory, provider);
    assert.equal(first.cached, false); assert.equal(calls, 3);
    const second = await refreshQboFinancialStatements('2026-02-09', 'Synthetic Test Company', directory, provider);
    assert.equal(second.cached, true); assert.equal(calls, 3, 'Repeated refresh must not contact QBO.');
    const snapshots = fs.readdirSync(directory).filter(file => /^[a-f0-9]{64}\.json$/.test(file));
    const before = snapshots.map(file => fs.readFileSync(path.join(directory, file), 'utf8'));
    fs.writeFileSync(path.join(directory, 'qbo-refresh.json'), JSON.stringify({ ...first, refreshedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString() }));
    await assert.rejects(refreshQboFinancialStatements('2026-02-09', 'Synthetic Test Company', directory, { ...provider, readReport: async (start, end) => { if (start.startsWith('2025')) throw new Error('Synthetic prior-year outage'); return provider.readReport(start, end); } }), /outage/);
    assert.deepEqual(snapshots.map(file => fs.readFileSync(path.join(directory, file), 'utf8')), before, 'Partial API failure must preserve both snapshots.');
    assert.equal(fs.existsSync(path.join(directory, 'qbo-refresh.lock')), false);
    fs.writeFileSync(path.join(directory, 'qbo-refresh.lock'), 'Synthetic active owner');
    await assert.rejects(refreshQboFinancialStatements('2026-02-09', 'Synthetic Test Company', directory, provider), { code: 'EEXIST' });
    fs.unlinkSync(path.join(directory, 'qbo-refresh.lock'));
    await assert.rejects(refreshQboFinancialStatements('2026-02-09', 'Another Company', directory, provider), /company does not match/);
    console.log('PASS: serialized QBO refresh, durable cooldown, company verification, failed-report preservation and lock cleanup. No live calls.');
  } finally { fs.rmSync(directory, { recursive: true }); }
}
verifyRefresh().catch(error => { console.error(error); process.exitCode = 1; });
