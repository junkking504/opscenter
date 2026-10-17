import path from 'node:path';
import { importKnowledgeHistory } from '../lib/knowledge-import';
import { vaultKnowledgeManifest } from '../lib/vault-knowledge';
const args = process.argv.slice(2);
const vault = args.find(value => !value.startsWith('--'));
const target = args.find(value => value.startsWith('--directory='))?.slice('--directory='.length);
if (!vault || !path.isAbsolute(vault) || !target || !path.isAbsolute(target) || args.some(value => value.startsWith('--') && value !== '--apply' && !value.startsWith('--directory='))) {
  throw new Error('Usage: node --import tsx scripts/publish-vault-knowledge.ts /absolute/vault --directory=/absolute/private/store [--apply]. Defaults to a dry run.');
}
const manifest = vaultKnowledgeManifest(vault);
const report = importKnowledgeHistory(manifest, target, args.includes('--apply'));
console.log(JSON.stringify({ notes: manifest.records.map(record => record.sourceNote), ...report }, null, 2));
if (report.conflicts.length) process.exitCode = 2;
