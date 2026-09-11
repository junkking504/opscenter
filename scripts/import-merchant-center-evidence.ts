import fs from 'node:fs';
import path from 'node:path';
import { validateMerchantSnapshot } from '../lib/merchant-center-evidence';

const file = process.argv[2];
if (!file) throw new Error('Usage: node --import tsx scripts/import-merchant-center-evidence.ts <normalized-evidence.json>');
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
const snapshot = validateMerchantSnapshot(value, value.date);
const root = process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data');
const directory = path.join(root, 'imports/merchant_center/junk_krewe');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const target = path.join(directory, `${snapshot.complete ? 'transactions' : 'details'}-${snapshot.date}.json`);
if (fs.existsSync(target)) {
  const existing = validateMerchantSnapshot(JSON.parse(fs.readFileSync(target, 'utf8')), snapshot.date);
  if (Date.parse(existing.collectedAt) > Date.parse(snapshot.collectedAt)) throw new Error('Refusing to replace newer evidence.');
  if (!snapshot.complete) snapshot.transactions = [...new Map([...existing.transactions, ...snapshot.transactions].map(t => [t.transactionId, t])).values()];
}
const temporary = `${target}.${process.pid}.tmp`;
fs.writeFileSync(temporary, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
fs.renameSync(temporary, target);
console.log(JSON.stringify({ date: snapshot.date, transactions: snapshot.transactions.length, complete: snapshot.complete, output: target }));
