import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { extractJkNumbers } from './whatsapp-job-photo-matching';
import type { WhatsAppImageMessage } from './whatsapp-job-photo-queue';

/** Conservative eligibility keeps alternate workflows on their existing path. */
export function jobPhotoPrefetchEligible(message: WhatsAppImageMessage): boolean {
  const context = message.matchingContext;
  const simple = (text: string) => !text.replace(/\bJK\s*[-#:]*\s*\d{4,12}\b/gi, '')
    .replace(/\b(?:before|after|donation|receipt|photos?)\b/gi, '').replace(/[\s#:,.-]/g, '');
  if (message.version !== 1 || !message.messageId || !/^\d+$/.test(message.mediaId)
    || !/^\d+$/.test(message.phoneNumberId)
    || (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_PHONE_NUMBER_ID.trim() !== message.phoneNumberId)
    || !Number.isFinite(Date.parse(message.receivedAt))
    || !['image/jpeg', 'image/png'].includes(message.mimeType)
    || !/^(?:[a-f\d]{64}|[A-Za-z\d+/]{43}=)$/i.test(message.sha256 || '')
    || !context || context.version !== 1 || context.reviewReason || context.recycling || context.resale
    || typeof message.caption !== 'string' || typeof context.text !== 'string'
    || !simple(message.caption) || !simple(context.text)) return false;
  return extractJkNumbers(message.caption || context.text).length === 1
    || (extractJkNumbers(message.caption).length === 0 && extractJkNumbers(context.text).length === 1);
}

export function readJobPhotoPrefetchCandidate(file: string | undefined): WhatsAppImageMessage | null {
  if (!file || !/^[a-f\d]{64}\.json$/.test(path.basename(file))) return null;
  try {
    const stats = fs.lstatSync(file);
    if (!stats.isFile() || stats.size > 256_000) return null;
    const message = JSON.parse(fs.readFileSync(file, 'utf8')) as WhatsAppImageMessage;
    if (!jobPhotoPrefetchEligible(message)
      || `${crypto.createHash('sha256').update(message.messageId).digest('hex')}.json` !== path.basename(file)) return null;
    return message;
  } catch { return null; }
}

type Result = { ok: true; file: string } | { ok: false; error: unknown };
type Task = { key: string; prefetched: boolean; startedAt?: string; readyAt?: string; result: Promise<Result> };

/** One lookahead slot, one active downloader, and no background rejection/retry. */
export function createWhatsAppPhotoPrefetch(download: (message: WhatsAppImageMessage) => Promise<string>) {
  let slot: Task | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  const pending = new Map<string, Task>();
  const keyOf = (message: WhatsAppImageMessage) => JSON.stringify([message.messageId, message.mediaId, message.phoneNumberId, message.mimeType, message.sha256]);
  const start = (message: WhatsAppImageMessage, prefetched: boolean): Task => {
    const key = keyOf(message);
    const existing = pending.get(key);
    if (existing) return existing;
    const task: Task = { key, prefetched, result: Promise.resolve({ ok: false, error: new Error('Download not started.') }) };
    task.result = tail.then(async (): Promise<Result> => {
      task.startedAt = new Date().toISOString();
      try {
        const file = await download(message);
        task.readyAt = new Date().toISOString();
        return { ok: true, file };
      } catch (error) { return { ok: false, error }; }
    });
    tail = task.result;
    pending.set(key, task);
    return task;
  };
  return {
    prefetch(message: WhatsAppImageMessage): boolean {
      if (closed || slot || !jobPhotoPrefetchEligible(message)) return false;
      slot = start(message, true);
      return true;
    },
    async download(message: WhatsAppImageMessage, timing?: Record<string, string>): Promise<string> {
      if (closed) throw new Error('Photo media preparation is closed.');
      const key = keyOf(message);
      const task = slot?.key === key ? slot : start(message, false);
      const result = await task.result;
      if (timing && task.prefetched) {
        if (task.startedAt) timing.mediaPrefetchStartedAt = task.startedAt;
        if (task.readyAt) timing.mediaPrefetchReadyAt = task.readyAt;
      }
      pending.delete(key);
      if (slot === task) slot = undefined;
      if (!result.ok) throw result.error;
      return result.file;
    },
    async discardExcept(message?: WhatsAppImageMessage): Promise<void> {
      const orphan = slot;
      if (!orphan || (message && orphan.key === keyOf(message))) return;
      await orphan.result;
      pending.delete(orphan.key);
      if (slot === orphan) slot = undefined;
    },
    async close(): Promise<void> { closed = true; await tail; pending.clear(); slot = undefined; },
  };
}
