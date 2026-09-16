import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { extractJkNumbers, normalizePhone } from './whatsapp-job-photo-matching';
import type { WhatsAppImageMessage, WhatsAppTextMessage } from './whatsapp-job-photo-queue';

type RecordValue = WhatsAppImageMessage & Record<string, unknown>;
type Binding = { version: 1; reason: 'explicit_job_after_photo_burst'; fingerprint: string; boundAt: string; text: WhatsAppTextMessage; originalMatchingContext: WhatsAppImageMessage['matchingContext'] };
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const recordName = (messageId: string) => `${hash(messageId)}.json`;
const modifier = (text: unknown) => /^(?:(?:before|after|donation(?: receipt)?|photos?)\s*[.!]?)?$/i.test(String(text || '').trim());
const explicitJob = (text: unknown) => /^#?\s*JK\s*[-#:]*\s*\d{4,12}\s*[.!]?$/i.test(String(text || '').trim()) ? extractJkNumbers(String(text))[0] : undefined;
const sameSender = (a: { senderPhone: string; phoneNumberId: string }, b: { senderPhone: string; phoneNumberId: string }) => normalizePhone(a.senderPhone) === normalizePhone(b.senderPhone) && a.phoneNumberId === b.phoneNumberId;
const fingerprint = (message: WhatsAppImageMessage) => hash(JSON.stringify([message.messageId, message.senderPhone, message.phoneNumberId, message.receivedAt, message.timestampSource, message.mediaId, message.mimeType, message.sha256, message.caption, message.matchingContext]));
/** Share the binder's lock with normal claims, so a stale review cannot be
 * published between a competing claim and its processing-file check. */
export function withPhotoContextClaimLock<T>(root: string, name: string, claim: () => T): T | null {
  const folder = path.join(root, 'context-bindings');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const lock = path.join(folder, `${name}.lock`);
  let fd: number;
  try { fd = fs.openSync(lock, 'wx', 0o600); } catch { return null; }
  try { return claim(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function read(file: string): RecordValue | null {
  try { const stat = fs.lstatSync(file); return stat.isFile() && stat.size <= 256_000 ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; }
}
function missingContext(message: RecordValue): boolean {
  const context = message.matchingContext;
  const review = message.review as { reason?: string } | undefined;
  return message.version === 1 && message.timestampSource === 'provider' && Boolean(message.messageId) && Number.isFinite(Date.parse(message.receivedAt))
    && !message.match && !message.upload && !message.recycling && !message.resale && !message.truckLoadPhoto && !message.truckLoadStatus
    && modifier(message.caption) && (!context || (context.version === 1 && modifier(context.text) && !context.reviewReason && !context.recycling && !context.resale))
    && (!review || ['sender_not_mapped_to_truck', 'truck_gps_unavailable', 'truck_gps_stale', 'job_coordinates_unavailable', 'truck_not_near_active_job', 'nearest_job_ambiguous'].includes(review.reason || ''));
}
function history(root: string, message: { senderPhone: string; phoneNumberId: string }, first: number, last: number): WhatsAppTextMessage[] {
  const folder = path.join(root, 'context-history', hash(normalizePhone(message.senderPhone)), hash(message.phoneNumberId));
  try {
    const names = fs.readdirSync(folder).filter(name => /^\d{13}-[a-f0-9]{64}\.json$/.test(name) && Number(name.slice(0, 13)) >= first && Number(name.slice(0, 13)) <= last);
    if (names.length > 200) return [{ text: 'ambiguous dense context' } as WhatsAppTextMessage];
    return names.flatMap(name => { const row = read(path.join(folder, name)); return row && sameSender(row, message) ? [row as unknown as WhatsAppTextMessage] : []; });
  } catch { return []; }
}
function unambiguousHistory(root: string, message: WhatsAppImageMessage, text: WhatsAppTextMessage): boolean {
  const rows = history(root, message, Date.parse(message.receivedAt), Date.parse(message.receivedAt) + 20_000);
  return rows.some(row => row.messageId === text.messageId && row.text === text.text && row.receivedAt === text.receivedAt && row.timestampSource === 'provider' && row.sourceType !== 'image-caption')
    && rows.every(row => modifier(row.text) || (row.sourceType !== 'image-caption' && explicitJob(row.text) === explicitJob(text.text)));
}

/** A sidecar never mutates an incoming or already-processing queue record. */
export function applyTrailingPhotoJobBinding(message: WhatsAppImageMessage, root: string, now = Date.now()): WhatsAppImageMessage {
  if (!missingContext(message as RecordValue)) return message;
  const binding = read(path.join(root, 'context-bindings', recordName(message.messageId))) as unknown as Binding | null;
  const textAt = Date.parse(binding?.text?.receivedAt || ''), boundAt = Date.parse(binding?.boundAt || ''), photoAt = Date.parse(message.receivedAt);
  if (!binding || !binding.text || binding.text.timestampSource !== 'provider' || !Number.isFinite(textAt) || !Number.isFinite(boundAt)
    || textAt < photoAt || textAt - photoAt > 20_000 || boundAt < textAt - 5_000 || boundAt - textAt > 60_000
    || boundAt > now + 5_000 || now - boundAt > 60_000 || binding.version !== 1 || binding.reason !== 'explicit_job_after_photo_burst' || binding.fingerprint !== fingerprint(message)
    || !sameSender(message, binding.text) || !explicitJob(binding.text.text) || !unambiguousHistory(root, message, binding.text)) return message;
  const contextText = [message.matchingContext?.text, explicitJob(binding.text.text)].filter(Boolean).join(' ');
  return { ...message, matchingContext: { version: 1, text: contextText, sourceMessageIds: [binding.text.messageId], capturedAt: binding.boundAt },
    trailingJobBinding: binding };
}

/** Bind only one recent, unassigned photo burst to its explicit following JK.
 * Existing assignments and in-flight records remain untouched. */
export function bindTrailingPhotoJobText(root: string, text: WhatsAppTextMessage, now = Date.now()): number {
  const at = Date.parse(text.receivedAt), job = explicitJob(text.text);
  if (!job || text.timestampSource !== 'provider' || text.sourceType === 'image-caption' || !Number.isFinite(at) || at > now + 5_000 || now - at > 60_000) return 0;
  const rows: { state: string; file: string; message: RecordValue; at: number }[] = [];
  for (const state of ['incoming', 'review', 'processing', 'completed', 'failed']) {
    const folder = path.join(root, state);
    let names: string[]; try { names = fs.readdirSync(folder); } catch { continue; }
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const file = path.join(folder, name), message = read(file);
      if (!message || !sameSender(message, text)) continue;
      const photoAt = Date.parse(message.receivedAt);
      if (photoAt >= at - 20_000 && photoAt <= at) rows.push({ state, file, message, at: photoAt });
    }
  }
  if (!rows.length || rows.length > 100 || rows.some(row => row.message.messageId === text.messageId)) return 0;
  rows.sort((a, b) => a.at - b.at);
  const first = rows[0].at, last = rows[rows.length - 1].at;
  if (at - last > 10_000 || last - first > 10_000 || rows.some((row, i) => i > 0 && row.at - rows[i - 1].at > 3_000)) return 0;
  // A previously bound member of this same burst is consistent, but another
  // assignment/workflow makes the album identity ambiguous.
  if (rows.some(({ message }) => !missingContext(message)
    && !(message.trailingJobBinding && (message.trailingJobBinding as Binding).text?.messageId === text.messageId))) return 0;
  if (rows.some(({ message }) => !unambiguousHistory(root, message, text))) return 0;
  const folder = path.join(root, 'context-bindings'); fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  let bound = 0;
  for (const row of rows) {
    if (!['incoming', 'review'].includes(row.state) || !missingContext(row.message)) continue;
    const name = recordName(row.message.messageId);
    if (path.basename(row.file) !== name) continue;
    const lock = path.join(folder, `${name}.lock`);
    let fd: number; try { fd = fs.openSync(lock, 'wx', 0o600); } catch { continue; }
    try {
      const current = read(row.file);
      if (!current || fingerprint(current) !== fingerprint(row.message) || !missingContext(current)) continue;
      if (['processing', 'completed', 'failed'].some(state => fs.existsSync(path.join(root, state, name)))) continue;
      const binding: Binding = { version: 1, reason: 'explicit_job_after_photo_burst', fingerprint: fingerprint(current), boundAt: new Date(now).toISOString(), text, originalMatchingContext: current.matchingContext };
      const temporary = path.join(folder, `${name}.${crypto.randomUUID()}.tmp`);
      try {
        fs.writeFileSync(temporary, JSON.stringify(binding), { flag: 'wx', mode: 0o600 });
        try { fs.linkSync(temporary, path.join(folder, name)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      if (applyTrailingPhotoJobBinding(current, root) === current) continue;
      if (row.state === 'review') {
        // Hardlink publication is atomic and refuses an existing destination.
        // The per-message lock prevents another binder publishing this hold twice.
        try { fs.linkSync(row.file, path.join(root, 'incoming', name)); }
        catch (error) { if (['EEXIST', 'ENOENT'].includes((error as NodeJS.ErrnoException).code || '')) continue; throw error; }
        fs.unlinkSync(row.file);
      }
      bound++;
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  return bound;
}

/** Handles a text webhook that beat a delayed image, or arrived during its first
 * processing attempt; only a subsequently unassigned review can be requeued. */
export function bindAvailableTrailingPhotoJobText(root: string, message: WhatsAppImageMessage): void {
  if (!missingContext(message as RecordValue)) return;
  const at = Date.parse(message.receivedAt);
  const candidates = history(root, message, at, at + 20_000).filter(row => explicitJob(row.text) && row.sourceType !== 'image-caption');
  if (new Set(candidates.map(row => explicitJob(row.text))).size !== 1) return;
  for (const text of candidates.sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))) bindTrailingPhotoJobText(root, text);
}
