import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getQboConfig } from './qbo-config';
import { getQboCompanyInfo, getQboProfitAndLoss } from './qbo-api';
import { normalizeQboProfitAndLoss } from './qbo-financial-statements';
import { financialStatementsDirectory, readFinancialStatements } from './financial-statements';

export const QBO_REPORT_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
function atomic(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
type Dependencies = { readCompany: () => Promise<Record<string, unknown>>; readReport: (start: string, end: string) => Promise<Record<string, unknown>> };
export async function refreshQboFinancialStatements(through: string, expectedCompany: string, directory = financialStatementsDirectory(), dependencies?: Dependencies) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(through) || new Date(`${through}T12:00:00Z`).toISOString().slice(0, 10) !== through || !expectedCompany) throw new Error('A valid date and exact company name are required.');
  const config = getQboConfig();
  if (!dependencies && !config.ready) throw new Error('QBO setup is incomplete.');
  const provider = dependencies || { readCompany: () => getQboCompanyInfo(config.environment), readReport: (start: string, end: string) => getQboProfitAndLoss(config.environment, start, end) };
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, 'qbo-refresh.lock');
  const lockHandle = fs.openSync(lock, 'wx', 0o600);
  try {
    fs.writeFileSync(lockHandle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const stateFile = path.join(directory, 'qbo-refresh.json');
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
    if (state) {
      if (!Number.isFinite(Date.parse(state.refreshedAt))) throw new Error('QBO refresh history needs review.');
      const age = Date.now() - Date.parse(state.refreshedAt);
      if (age < 0) throw new Error('QBO refresh history is in the future.');
      if (age < QBO_REPORT_REFRESH_INTERVAL_MS) {
        if (state.company !== expectedCompany || state.through !== through) throw new Error('Another report scope was refreshed recently. Retry after 15 minutes.');
        const snapshot = readFinancialStatements(directory);
        if (!snapshot.available || snapshot.error || !snapshot.records.some(r => r.sourceKind === 'qbo')) throw new Error('QBO snapshot needs recovery.');
        return { ...state, cached: true };
      }
    }
    const company = await provider.readCompany();
    if (company.CompanyName !== expectedCompany) throw new Error('Connected QBO company does not match the requested company.');
    const year = Number(through.slice(0, 4));
    const prior = new Date(`${year - 1}-${through.slice(5)}T12:00:00Z`);
    if (prior.getUTCMonth() + 1 !== Number(through.slice(5, 7))) prior.setUTCDate(0);
    const outputs = [];
    for (const end of [through, prior.toISOString().slice(0, 10)]) {
      const start = `${end.slice(0, 4)}-01-01`;
      const report = await provider.readReport(start, end);
      const header = report.Header as { StartPeriod?: string; EndPeriod?: string };
      if (header?.StartPeriod !== start || header.EndPeriod !== end) throw new Error('QBO returned a different reporting period.');
      const sourceId = crypto.createHash('sha256').update(`${config.environment}:${company.Id}:${expectedCompany}:${start}:Accrual:ProfitAndLoss`).digest('hex');
      const records = normalizeQboProfitAndLoss(report, expectedCompany, sourceId);
      const rawSha = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');
      outputs.push({ sourceId, rawSha, records, report });
    }
    for (const output of outputs) {
      atomic(path.join(directory, 'sources', `${output.rawSha}.json`), output.report);
      atomic(path.join(directory, `${output.sourceId}.json`), { schemaVersion: 1, sourceId: output.sourceId, rawSha: output.rawSha, importedAt: new Date().toISOString(), records: output.records });
    }
    const result = { company: expectedCompany, through, priorThrough: prior.toISOString().slice(0, 10), sources: outputs.length, months: outputs.reduce((sum, output) => sum + output.records.length, 0), refreshedAt: new Date().toISOString() };
    atomic(stateFile, result);
    return { ...result, cached: false };
  } finally {
    fs.closeSync(lockHandle);
    fs.unlinkSync(lock);
  }
}
