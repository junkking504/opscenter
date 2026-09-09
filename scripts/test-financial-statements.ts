import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { preferredStatements, statementMetrics, statementYearCoverage, type FinancialStatement } from '../desktop-ui/lib/financial-statements';
import { readFinancialStatements } from '../lib/financial-statements';

const sourceId = 'a'.repeat(64);
const base: FinancialStatement = {
  id: `${sourceId}:2026-01`, sourceId, sourceKind: 'workbook', sourceName: 'Synthetic draft.xlsx', sheet: 'P&L',
  company: 'Synthetic Test Company', month: '2026-01', reportThrough: '2026-01', basis: 'Accrual', status: 'Draft',
  totals: Object.fromEntries(statementMetrics.map(([key]) => [key, 100])) as FinancialStatement['totals'],
  rows: [{ label: 'An actual zero', cents: 0, cell: 'B10', formula: null }, { label: 'An absent value', cents: null, cell: 'B11', formula: null }],
  supplemental: [], annotations: [], warnings: [],
};
const feb = { ...base, id: `${sourceId}:2026-02`, month: '2026-02', reportThrough: '2026-02' };
const revised = { ...base, id: 'revision', sourceName: 'Later draft.xlsx', reportThrough: '2026-02', totals: { ...base.totals, netIncome: -200 } };
assert.equal(preferredStatements([revised, base])[0].totals.netIncome, -200);
assert.equal(preferredStatements([base, revised]).length, 1, 'Comparative columns must not double count a month.');
assert.deepEqual(statementYearCoverage([feb], '2026-02').missing, ['2026-01']);
assert.equal(statementYearCoverage([feb], '2026-02').totals, null);
assert.equal(statementYearCoverage([base, revised, feb], '2026-02').totals?.netIncome, -100);
assert.equal(statementYearCoverage([{ ...base, basis: 'Unspecified' }], '2026-01').totals, null);
assert.equal(statementYearCoverage([base, { ...feb, basis: 'Cash' }], '2026-02').totals, null);
assert.equal(preferredStatements([base, { ...base, company: 'Different Company' }]).length, 2);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'statement-test-'));
try {
  assert.equal(readFinancialStatements(directory).available, false);
  const file = path.join(directory, `${sourceId}.json`);
  const source = { schemaVersion: 1, importedAt: '2026-03-01T12:00:00Z', records: [base] };
  fs.writeFileSync(file, JSON.stringify(source));
  const read = readFinancialStatements(directory);
  assert.equal(read.records[0].rows[0].cents, 0);
  assert.equal(read.records[0].rows[1].cents, null);
  assert.equal(read.error, null);
  fs.writeFileSync(file, JSON.stringify({ ...source, records: [{ ...base, totals: { ...base.totals, netIncome: '100' } }] }));
  assert.equal(readFinancialStatements(directory).available, false);
  assert.match(readFinancialStatements(directory).error!, /needs review/);
  fs.writeFileSync(file, '{malformed');
  assert.equal(readFinancialStatements(directory).records.length, 0);
} finally { fs.rmSync(directory, { recursive: true }); }
console.log('PASS: statement revisions, company boundaries, missing YTD, basis mismatch, zero vs missing, malformed source isolation.');
