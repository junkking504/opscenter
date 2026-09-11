import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { RecyclingRecord } from '../desktop-ui/lib/commercial-contract';
import type { RecyclingReceiptDraft, RecyclingReceiptPhoto } from '../desktop-ui/lib/recycling-receipts';
export const recyclingVersion = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const recyclingDirectory = () => process.env.OPSCENTER_DESKTOP_COMMERCIAL_DIR || path.join(process.cwd(), 'data', 'desktop-commercial');
export function readRecyclingData(): { schemaVersion: number; records: RecyclingRecord[]; receiptDrafts?: RecyclingReceiptDraft[]; [key:string]: unknown } {
  try { const store = JSON.parse(fs.readFileSync(path.join(recyclingDirectory(), 'recycling-store'), 'utf8')); if (store.schemaVersion !== 1 || !Array.isArray(store.records)) throw new Error('Recycling store requires recovery'); return store; }
  catch(error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, records: [] }; throw error; }
}
export function writeRecyclingData(store: ReturnType<typeof readRecyclingData>) {
  const file = path.join(recyclingDirectory(), 'recycling-store');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(store), { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file);
}
export function recyclingPhotoPath(id: string, mime: string) {
  if (!/^[a-f0-9]{64}$/.test(id) || !['image/jpeg','image/png'].includes(mime)) throw new Error('Invalid recycling photo');
  return path.join(recyclingDirectory(), 'receipt-photos', `${id}.${mime === 'image/png' ? 'png' : 'jpg'}`);
}
export function appendRecyclingReceiptPhoto(id: string, photo: RecyclingReceiptPhoto, yard: string): RecyclingReceiptDraft {
  fs.mkdirSync(recyclingDirectory(), { recursive: true, mode: 0o700 });
  const lock = path.join(recyclingDirectory(), '.write-lock'); fs.mkdirSync(lock, { mode: 0o700 });
  try {
    const store = readRecyclingData(); store.receiptDrafts ||= [];
    const existingPhoto = store.receiptDrafts.find(draft => draft.photos.some(item => item.photoId === photo.photoId));
    if (existingPhoto) return existingPhoto;
    let draft = store.receiptDrafts.find(draft => draft.id === id && draft.status === 'review');
    // A page arriving after recording becomes a new review item, never alters posted runs.
    if (!draft) { draft = { id: store.receiptDrafts.some(item => item.id === id) ? photo.photoId : id, version: '', receivedAt: photo.receivedAt, updatedAt: photo.receivedAt, status: 'review', photos: [], yard, rows: [], total: null, warnings: [] }; store.receiptDrafts.push(draft); }
    draft.photos.push(photo); draft.rows = draft.photos.flatMap(item => item.rows.map(row => ({ ...row, photoId: item.photoId })));
    const totals = [...new Set(draft.photos.flatMap(item => item.total == null ? [] : [item.total]))];
    draft.total = totals.length === 1 ? totals[0] : null;
    draft.warnings = [...new Set(draft.photos.flatMap(item => item.warnings))];
    if (totals.length > 1) draft.warnings.push('Conflicting receipt totals: check whether these pages belong together.');
    const sum = draft.rows.reduce((total, row) => total + Math.round((row.amount || 0)*100),0)/100;
    if (draft.total == null || draft.rows.some(row => row.amount == null) || Math.abs(sum-draft.total) > .005) draft.warnings.push('Extracted rows do not yet reconcile to a printed payment total.');
    draft.yard ||= yard; draft.updatedAt = new Date().toISOString(); draft.version = recyclingVersion({ ...draft, version: undefined });
    writeRecyclingData(store);
    return readRecyclingData().receiptDrafts!.find(item => item.id === draft!.id)!;
  } finally { fs.rmdirSync(lock); }
}
