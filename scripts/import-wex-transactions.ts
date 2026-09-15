import path from 'node:path';
import { importWexPostedCsv, wexFuelSnapshotFile } from '../lib/wex-fuel';

const sourceFile = process.argv[2];
const outputFile = process.argv[3] || wexFuelSnapshotFile();
if (!sourceFile) {
  console.error('Usage: npm run import:wex-fuel -- /path/to/Transactions.csv [output.json]');
  process.exit(2);
}

const snapshot = importWexPostedCsv(path.resolve(sourceFile), path.resolve(outputFile));
console.log(`Imported ${snapshot.transactionCount} posted WEX transactions covering ${snapshot.coverageFrom} through ${snapshot.coverageThrough}.`);
console.log(`Snapshot: ${path.resolve(outputFile)}`);
