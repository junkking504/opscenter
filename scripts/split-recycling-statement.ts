import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { splitRecyclingStatement } from '../lib/recycling-statement';
import { recyclingPhotoPath, recyclingVersion } from '../lib/recycling-receipt-store';
import type { RecyclingReceiptDraft, RecyclingReceiptPhoto } from '../desktop-ui/lib/recycling-receipts';
import type { RecyclingRecord } from '../desktop-ui/lib/commercial-contract';

// Explicit local data paths only. Default is read-only; --apply is required.
const args = process.argv.slice(2);
const [storeFile, statementFile, sourceId] = args.filter(value => value !== '--apply');
if (!storeFile || !statementFile || !sourceId || !path.isAbsolute(storeFile) || !path.isAbsolute(statementFile)) throw new Error('Usage: split-recycling-statement.ts /absolute/recycling-store /absolute/statement.json source-id [--apply]');
const auditFile = path.join(path.dirname(statementFile), 'daily-runs-import.json');
const lock = path.join(path.dirname(storeFile), '.write-lock');
const apply = args.includes('--apply');
if (apply) fs.mkdirSync(lock, { mode: 0o700 });
try {
  const before = fs.readFileSync(storeFile, 'utf8');
  const store = JSON.parse(before);
  if (store.schemaVersion !== 1 || !Array.isArray(store.records)) throw new Error('Unsupported recycling store');
  const source = store.records.find((row: RecyclingRecord) => row.id === sourceId);
  if (!source) {
    const prior = store.statementImports?.[sourceId];
    if (!prior || !prior.recordIds.every((id: string) => store.records.some((record: RecyclingRecord) => record.id === id))) throw new Error('Source record unavailable; inspect existing state');
    console.log(JSON.stringify({ status: 'already-imported', ...prior }));
  } else {
    const statementText = fs.readFileSync(statementFile, 'utf8');
    const statement = JSON.parse(statementText);
    const stamp = new Date().toISOString();
    const records = splitRecyclingStatement(source, statement, stamp);
    if (records.some(row => store.records.some((existing: RecyclingRecord) => existing.id === row.id))) throw new Error('Daily entries already exist alongside the aggregate; review before retrying');
    const total = records.reduce((sum, row) => sum + Math.round(row.realizedValue! * 100), 0) / 100;
    const audit = { sourceId, importedAt: stamp, actor: 'jkops via Codex user-authorized daily run split', statementSha256: createHash('sha256').update(statementText).digest('hex'), recordIds: records.map(row => row.id), total, paymentDate: statement.payment_received_date };
    const photos: RecyclingReceiptPhoto[] = (statement.source_photos || []).map((photo: { file: string; sha256: string }, index: number) => {
      if (path.basename(photo.file) !== photo.file || !/\.(jpg|png)$/i.test(photo.file)) throw new Error('Invalid source photo filename');
      const original = path.join(path.dirname(statementFile), photo.file);
      const bytes = fs.readFileSync(original);
      const checksum = createHash('sha256').update(bytes).digest('hex');
      if (checksum !== photo.sha256) throw new Error('Source photo checksum mismatch');
      const mimeType = /\.png$/i.test(photo.file) ? 'image/png' : 'image/jpeg';
      if (apply) {
        process.env.OPSCENTER_DESKTOP_COMMERCIAL_DIR = path.dirname(storeFile);
        const target = recyclingPhotoPath(checksum, mimeType); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.writeFileSync(target, bytes, { mode: 0o600 });
      }
      return { photoId: checksum, mimeType, receivedAt: source.updatedAt, text: 'Verified source statement transcription', total: index === (statement.source_photos.length - 1) ? total : null, warnings: [],
        rows: statement.rows.filter((row: { page: number }) => row.page === index+1).map((row: { date: string; ticket: string; commodity: string; printed_net_lb: number; amount_usd: string }) => ({ date: row.date, ticket: row.ticket, material: row.commodity, weightLb: row.printed_net_lb, amount: Number(row.amount_usd) })) };
    });
    const draft: RecyclingReceiptDraft = { id: sourceId, version: '', receivedAt: source.updatedAt, updatedAt: stamp, status: 'recorded', photos, yard: source.yard, rows: photos.flatMap(photo => photo.rows), total, warnings: [], recordIds: records.map(row=>row.id) };
    draft.version = recyclingVersion({ ...draft, version: undefined });
    const next = { ...store, receiptDrafts: [...(store.receiptDrafts || []), ...(photos.length ? [draft] : [])], records: store.records.filter((record: RecyclingRecord) => record.id !== sourceId).concat(records),
      supersededRecords: [...(store.supersededRecords || []), source], statementImports: { ...store.statementImports, [sourceId]: audit } };
    if (apply) {
      const backup = path.join(path.dirname(statementFile), `recycling-store-before-daily-runs-${stamp.replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(backup, before, { mode: 0o600, flag: 'wx' });
      fs.writeFileSync(`${storeFile}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(`${storeFile}.tmp`, storeFile);
      if (JSON.stringify(JSON.parse(fs.readFileSync(storeFile, 'utf8'))) !== JSON.stringify(next)) throw new Error('Write read-back differs; inspect backup before retrying');
      fs.writeFileSync(auditFile, JSON.stringify({ ...audit, backup, status: 'verified' }, null, 2), { mode: 0o600 });
    }
    console.log(JSON.stringify({ status: apply ? 'verified' : 'dry-run', total, days: records.map(row => ({ date: row.date, amount: row.realizedValue, tickets: row.ticketCount, weightLb: row.netWeightLb })), paymentDate: statement.payment_received_date }, null, 2));
  }
} finally { if (apply) fs.rmdirSync(lock); }
