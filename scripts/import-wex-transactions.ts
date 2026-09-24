import fs from 'node:fs';
import path from 'node:path';
import { importWexPostedCsv, wexFuelSnapshotFile } from '../lib/wex-fuel';
import { enqueueWexExpenseAutomations } from '../lib/wex-expense-automation';

const sourceFile = process.argv[2];
const outputFile = process.argv[3] || wexFuelSnapshotFile();
if (!sourceFile) {
  console.error('Usage: npm run import:wex-fuel -- /path/to/Transactions.csv [output.json]');
  process.exit(2);
}

const resolvedOutput = path.resolve(outputFile);
let priorIds: Set<string> | null = null;
try {
  const prior = JSON.parse(fs.readFileSync(resolvedOutput, 'utf8')) as { transactions?: Array<{ transactionId?: string }> };
  priorIds = new Set((prior.transactions || []).map(row => String(row.transactionId || '')).filter(Boolean));
} catch { /* The first import establishes a baseline and does not backfill alerts or expenses. */ }
const snapshot = importWexPostedCsv(path.resolve(sourceFile), resolvedOutput);
const newTransactions = priorIds ? snapshot.transactions.filter(row => !priorIds!.has(row.transactionId)) : [];
const automation = resolvedOutput === path.resolve(wexFuelSnapshotFile())
  ? enqueueWexExpenseAutomations(newTransactions.filter(row => row.netCost > 0))
  : { queued: 0, matched: 0, review: 0, existing: 0 };
console.log(`Imported ${snapshot.transactionCount} posted WEX transactions covering ${snapshot.coverageFrom} through ${snapshot.coverageThrough}.`);
console.log(`New posted transactions: ${newTransactions.length}; expense automation queued ${automation.queued}, matched existing ${automation.matched}, review ${automation.review}.`);
console.log(`Snapshot: ${resolvedOutput}`);
