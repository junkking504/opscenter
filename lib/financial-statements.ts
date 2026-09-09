import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { statementMetrics, type FinancialStatement, type StatementData } from '../desktop-ui/lib/financial-statements';

export function financialStatementsDirectory() {
  return process.env.OPSCENTER_FINANCIAL_STATEMENTS_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'OpsCenter', 'financial-statements');
}
function validRecord(value: unknown): value is FinancialStatement {
  if (!value || typeof value !== 'object') return false;
  const r = value as FinancialStatement;
  const text = (v: unknown) => typeof v === 'string' && v.length <= 4000;
  const month = (v: unknown) => typeof v === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(v);
  const row = (v: FinancialStatement['rows'][number]) => v && text(v.label) && text(v.cell) && (v.formula === null || text(v.formula)) && (v.cents === null || Number.isSafeInteger(v.cents));
  return text(r.id) && /^[a-f0-9]{64}$/.test(r.sourceId) && text(r.sourceName) && text(r.company) && text(r.sheet)
    && ['workbook', 'qbo'].includes(r.sourceKind) && month(r.month) && month(r.reportThrough) && r.month <= r.reportThrough
    && ['Draft', 'Unreviewed', 'Current books'].includes(r.status) && ['Accrual', 'Cash', 'Unspecified'].includes(r.basis)
    && (r.periodEnd === undefined || typeof r.periodEnd === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(r.periodEnd) && r.periodEnd.startsWith(r.month))
    && (r.observedAt === undefined || typeof r.observedAt === 'string' && Number.isFinite(Date.parse(r.observedAt)))
    && (r.sourceKind !== 'qbo' || !!r.periodEnd && !!r.observedAt)
    && !!r.totals && statementMetrics.every(([key]) => Number.isSafeInteger(r.totals[key]))
    && Array.isArray(r.rows) && r.rows.length < 1000 && r.rows.every(row)
    && Array.isArray(r.supplemental) && r.supplemental.length < 1000 && r.supplemental.every(row)
    && Array.isArray(r.annotations) && r.annotations.every(a => a && text(a.cell) && text(a.text))
    && Array.isArray(r.warnings) && r.warnings.every(text);
}
export function readFinancialStatements(directory = financialStatementsDirectory()): StatementData {
  const empty: StatementData = { available: false, error: null, importedAt: null, records: [] };
  try {
    if (!fs.existsSync(directory)) return empty;
    const records: FinancialStatement[] = [];
    let importedAt: string | null = null;
    const files = fs.readdirSync(directory).filter(file => /^[a-f0-9]{64}\.json$/.test(file));
    if (files.length > 240) throw new Error('Too many statement sources.');
    for (const file of files) {
      const target = path.join(directory, file);
      if (fs.statSync(target).size > 2_000_000) throw new Error('Statement source exceeds limit.');
      const data = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (data.schemaVersion !== 1 || !Array.isArray(data.records) || !data.records.every(validRecord) || typeof data.importedAt !== 'string' || !Number.isFinite(Date.parse(data.importedAt))) throw new Error('Invalid statement source.');
      if (data.records.some((r: FinancialStatement) => `${r.sourceId}.json` !== file)) throw new Error('Statement source identity mismatch.');
      records.push(...data.records);
      if (!importedAt || data.importedAt > importedAt) importedAt = data.importedAt;
    }
    return { available: records.length > 0, error: null, importedAt, records };
  } catch {
    // A malformed import must not take the operational Finance workspace down.
    return { ...empty, error: 'Financial statement import needs review. Operational sources remain available.' };
  }
}
