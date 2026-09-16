import fs from 'node:fs';
import path from 'node:path';
import { importKnowledgeHistory } from '../lib/knowledge-import';
const args = process.argv.slice(2);
const file = args.find(value => !value.startsWith('--'));
const target = args.find(value => value.startsWith('--directory='))?.slice('--directory='.length);
if (!file || !target || !path.isAbsolute(target) || args.some(value => value.startsWith('--') && value !== '--apply' && !value.startsWith('--directory='))) {
  throw new Error('Usage: node --import tsx scripts/import-knowledge-history.ts MANIFEST --directory=/absolute/private/store [--apply]. Defaults to a dry run.');
}
const report = importKnowledgeHistory(JSON.parse(fs.readFileSync(file, 'utf8')), target, args.includes('--apply'));
console.log(JSON.stringify(report, null, 2));
if (report.conflicts.length) process.exitCode = 2;
