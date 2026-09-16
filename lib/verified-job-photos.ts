import fs from 'node:fs';
import path from 'node:path';
import { junkwareJobPhotos, junkwarePhotoMatchesAppointment, type JunkwareJobPhoto } from './junkware-job-details';

const MAX_RECEIPT_AGE_MS = 30 * 60_000;
type PhotoJob = { appointmentId: string; jkNumber: string; photos: JunkwareJobPhoto[]; photoAuditAvailable: boolean; photoObservedAt?: string };
type ReceiptIndex = { directoryVersion: string; known: Set<string>; recent: Set<string> };
const receiptIndexes = new Map<string, ReceiptIndex>();

/** Only existing JunkWare image URLs for this exact appointment may cross the receipt boundary. */
export function verifiedAppointmentMedia(values: unknown, appointmentId: string): JunkwareJobPhoto[] {
  if (!Array.isArray(values) || !/^\d{1,12}$/.test(appointmentId)) return [];
  const safe = values.filter(value => {
    if (typeof value !== 'string') return false;
    try {
      const url = new URL(value);
      return url.origin === 'https://junkware.junk-king.com' && !url.username && !url.password
        && !url.hash && !/%(?:2f|5c|2e)/i.test(url.pathname);
    } catch { return false; }
  });
  return junkwareJobPhotos({ photos: safe }).filter(photo => junkwarePhotoMatchesAppointment(photo, appointmentId));
}

export function newVerifiedAppointmentMedia(before: string[], after: string[], appointmentId: string): string[] {
  const existing = new Set(before.map(value => value.split('?')[0]));
  return [...new Set(verifiedAppointmentMedia(after, appointmentId)
    .filter(photo => !existing.has(photo.url.split('?')[0])).map(photo => photo.url))];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** A temporary read projection; never changes collector files or replays an upload. */
export function applyVerifiedPhotoReceipts<T extends PhotoJob>(jobs: T[], receipts: unknown[], now = Date.now()): T[] {
  return jobs.map(job => {
    const additions: JunkwareJobPhoto[] = [];
    const sourceAt = Date.parse(job.photoObservedAt || '');
    for (const value of receipts) {
      const receipt = record(value), match = record(receipt.match), upload = record(receipt.upload);
      const completedAt = Date.parse(String(receipt.outcomeAt || ''));
      if (receipt.outcome !== 'completed' || upload.verified !== true || match.status !== 'matched'
        || match.appointmentId !== job.appointmentId || match.jkNumber !== job.jkNumber
        || !/^JK\d{4,12}$/.test(job.jkNumber)
        || !Number.isSafeInteger(upload.beforeCount) || !Number.isSafeInteger(upload.afterCount)
        || Number(upload.beforeCount) < 0 || Number(upload.afterCount) <= Number(upload.beforeCount)
        || !Number.isFinite(completedAt) || completedAt > now || now - completedAt > MAX_RECEIPT_AGE_MS
        || (job.photoAuditAvailable && (!Number.isFinite(sourceAt) || sourceAt >= completedAt))) continue;
      additions.push(...verifiedAppointmentMedia(upload.mediaUrls, job.appointmentId));
    }
    if (!additions.length) return job;
    const seen = new Set(job.photos.map(photo => photo.url.split('?')[0]));
    const photos = [...job.photos];
    for (const photo of additions) {
      const key = photo.url.split('?')[0];
      if (!seen.has(key)) { seen.add(key); photos.push(photo); }
    }
    return photos.length === job.photos.length ? job : { ...job, photos, photoAuditAvailable: true };
  });
}

export function readRecentVerifiedPhotoReceipts(dataDir: string, now = Date.now()): unknown[] {
  const directory = path.join(process.env.WHATSAPP_JOB_PHOTO_STATE_DIR || path.join(dataDir, 'integrations', 'whatsapp-job-photos'), 'completed');
  try {
    const directoryStat = fs.statSync(directory);
    const version = `${directoryStat.mtimeMs}:${directoryStat.ctimeMs}`;
    let index = receiptIndexes.get(directory);
    if (!index) {
      index = { directoryVersion: '', known: new Set(), recent: new Set() };
      receiptIndexes.set(directory, index);
      if (receiptIndexes.size > 4) receiptIndexes.delete(receiptIndexes.keys().next().value!);
    }
    if (index.directoryVersion !== version) {
      const names = new Set(fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)));
      for (const name of names) if (!index.known.has(name)) index.recent.add(name);
      for (const name of index.recent) if (!names.has(name)) index.recent.delete(name);
      index.known = names;
      index.directoryVersion = version;
    }
    // Completed receipts are immutable. Index historical names once, then only
    // read recent candidates; new atomic queue moves change directory metadata.
    // Re-read recent files on every request, so repairs cannot hide behind a TTL.
    return [...index.recent].flatMap(name => {
      try {
        const file = path.join(directory, name), stats = fs.lstatSync(file);
        if (stats.mtimeMs < now - MAX_RECEIPT_AGE_MS) { index.recent.delete(name); return []; }
        if (!stats.isFile() || stats.size > 256_000) return [];
        return [JSON.parse(fs.readFileSync(file, 'utf8'))];
      } catch { return []; }
    });
  } catch { return []; }
}
