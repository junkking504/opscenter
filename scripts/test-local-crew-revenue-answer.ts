import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLocalCrewRevenueAnswer } from '../lib/local-crew-revenue-answer';

const sourceHome = fs.mkdtempSync(path.join(os.tmpdir(), 'local-crew-revenue-'));
const priorCwd = process.cwd();
const priorHome = process.env.HOME;
const priorData = process.env.OPSBOT_DATA_DIR;
try {
  const dataRoot = path.join(sourceHome, '.openclaw', 'workspace', 'opsbot', 'data');
  const metricsDirectory = path.join(dataRoot, 'history', 'daily_metrics');
  fs.mkdirSync(metricsDirectory, { recursive: true });
  fs.writeFileSync(path.join(metricsDirectory, 'daily_metrics_2026-09-01.json'), JSON.stringify({
    generated_at: '2026-09-01T20:00:00Z',
    employee_leaderboard: [{ name: 'Gabriel Smith', credited_revenue: 125.25, jobs_completed: 2 }],
  }));
  fs.writeFileSync(path.join(metricsDirectory, 'daily_metrics_2026-09-02.json'), JSON.stringify({
    generated_at: '2026-09-02T20:00:00Z',
    employee_leaderboard: [{ name: 'Gabriel Smith', credited_revenue: 374.75, jobs_completed: 3 }],
  }));
  process.env.HOME = sourceHome;
  process.env.OPSBOT_DATA_DIR = dataRoot;
  const isolatedCwd = path.join(sourceHome, 'checkout');
  fs.mkdirSync(isolatedCwd);
  process.chdir(isolatedCwd);

  const answer = buildLocalCrewRevenueAnswer("what is Gabriel's revenue for the month of September?", '2026-09-02', 'manager');
  assert(answer);
  assert.equal(answer.model, 'OpsCenter sources');
  assert.match(answer.answer, /Gabriel Smith attributed revenue: \$500\.00/);
  assert.match(answer.answer, /5 employee job credits/);
  assert.match(answer.answer, /Daily source coverage is complete/);
  assert.match(answer.sources[0].href, /kreweView=monthly/);
  const incomplete = buildLocalCrewRevenueAnswer('Gabriel monthly attributed revenue', '2026-09-03', 'manager');
  assert.match(incomplete?.answer || '', /Sep 3, 2026 is missing/);
  assert.match(incomplete?.answer || '', /not a verified complete-period total/);
  assert.equal(buildLocalCrewRevenueAnswer('what is Gabriel revenue today?', '2026-09-02', 'manager'), null);
  assert.equal(buildLocalCrewRevenueAnswer('what is September revenue?', '2026-09-02', 'manager'), null);
  assert.throws(() => buildLocalCrewRevenueAnswer('what is Gabriel monthly revenue?', '2026-09-02', 'operator'), /Manager access/);
  console.log('Local Ask OpsBot crew revenue: unique employee, monthly attribution, coverage, role boundary, and no-match fallback passed.');
} finally {
  process.chdir(priorCwd);
  if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome;
  if (priorData === undefined) delete process.env.OPSBOT_DATA_DIR; else process.env.OPSBOT_DATA_DIR = priorData;
  fs.rmSync(sourceHome, { recursive: true, force: true });
}
