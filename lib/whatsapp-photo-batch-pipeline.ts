import fs from 'node:fs';
import type { PhotoUploadInput, PhotoUploadResult } from './junkware-photo-uploader';
import { queuedWhatsAppImages, type WhatsAppImageMessage } from './whatsapp-job-photo-queue';
import { readJobPhotoPrefetchCandidate } from './whatsapp-photo-prefetch';

/** Download existing originals concurrently without adding requests or retries. */
export function createPhotoDownloadPool(download: (message: WhatsAppImageMessage) => Promise<string>, limit = 4) {
  const cap = Math.min(4, Math.max(1, Math.floor(limit)));
  const waiting: (() => void)[] = [];
  const tasks = new Map<string, Promise<string>>();
  let active = 0, closed = false;
  return {
    download(message: WhatsAppImageMessage): Promise<string> {
      if (closed) return Promise.reject(new Error('Photo downloads are closed.'));
      const key = JSON.stringify([message.messageId, message.mediaId, message.phoneNumberId, message.mimeType, message.sha256]);
      const prior = tasks.get(key);
      if (prior) return prior;
      const task = new Promise<void>(resolve => {
        if (active < cap) { active++; resolve(); } else waiting.push(resolve);
      }).then(() => download(message)).finally(() => {
        const next = waiting.shift();
        if (next) next(); else active--;
      });
      // Retain a failed attempt until this bounded worker cycle ends. A retry
      // belongs to the existing queue policy, never to the media scheduler.
      void task.catch(() => {});
      tasks.set(key, task);
      return task;
    },
    async close() { closed = true; await Promise.allSettled(tasks.values()); tasks.clear(); },
  };
}

type BatchResult = { results: ({ filePath: string; status: 'verified'; verification: PhotoUploadResult } | { filePath: string; status: 'uncertain'; error: string })[] };
type Pending = { input: PhotoUploadInput; bytes: number; resolve: (result: PhotoUploadResult) => void; reject: (error: Error) => void };
const GROUP_BYTES = Math.floor(4.5 * 1024 * 1024);
const sameTarget = (a: PhotoUploadInput, b: PhotoUploadInput) => a.appointmentId === b.appointmentId && a.jkNumber === b.jkNumber && a.category === b.category;

/** One native JunkWare request at a time. Only ready, same-target files group. */
export function createPhotoUploadBatchQueue(uploadBatch: (inputs: PhotoUploadInput[]) => Promise<BatchResult>) {
  const pending: Pending[] = [];
  let running: Promise<void> | undefined, timer: ReturnType<typeof setTimeout> | undefined, closed = false;
  async function drain() {
    while (pending.length) {
      const group = [pending.shift()!];
      let bytes = group[0].bytes;
      // Keep the oldest photo first, then fill spare capacity from ready photos
      // for that same job. A large next photo must not force a nearly empty POST.
      // Stop at a different target/category so unrelated work keeps its order.
      for (let index = 0; index < pending.length && group.length < 5;) {
        if (!sameTarget(group[0].input, pending[index].input)) break;
        if (bytes + pending[index].bytes > GROUP_BYTES) { index++; continue; }
        const [next] = pending.splice(index, 1); group.push(next); bytes += next.bytes;
      }
      try {
        const result = await uploadBatch(group.map(item => item.input));
        for (const item of group) {
          const matches = result.results.filter(row => row.filePath === item.input.filePath);
          const match = matches.length === 1 ? matches[0] : undefined;
          if (match?.status === 'verified') item.resolve(match.verification);
          else item.reject(new Error(match?.status === 'uncertain' ? match.error : 'JunkWare did not verify this exact photo.'));
        }
      } catch (error) {
        for (const item of group) item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  function start() {
    timer = undefined;
    running = drain().finally(() => { running = undefined; if (pending.length) schedule(); });
  }
  function schedule() { if (!running && !timer) timer = setTimeout(start, 100); }
  return {
    upload(input: PhotoUploadInput): Promise<PhotoUploadResult> {
      if (closed) return Promise.reject(new Error('Photo upload batching is closed.'));
      try {
        const stat = fs.lstatSync(input.filePath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > 5 * 1024 * 1024) throw new Error('Photo size is outside the verified upload limits.');
        return new Promise((resolve, reject) => { pending.push({ input, bytes: stat.size, resolve, reject }); schedule(); });
      } catch (error) { return Promise.reject(error); }
    },
    async close() {
      closed = true;
      if (timer) { clearTimeout(timer); start(); }
      while (running) await running;
    },
  };
}

/** Only uncomplicated explicit-JK photos overlap; alternate workflows stay serial. */
export async function drainConcurrentPhotoQueue(process: (file: string) => Promise<void>, limit = 100, concurrency = 8): Promise<number> {
  const attempted = new Set<string>();
  const attemptedWithBinding = new Set<string>();
  let attempts = 0;
  const running = new Set<Promise<void>>();
  const cap = Math.min(100, Math.max(0, Math.floor(limit)));
  const lanes = Math.min(8, Math.max(1, Math.floor(concurrency)));
  let failure: unknown;
  try {
    while (attempts < cap && !failure) {
      if (running.size >= lanes) { await Promise.race(running); continue; }
      const next = queuedWhatsAppImages(1, attempted)[0]
        || queuedWhatsAppImages(cap).find(file => attempted.has(file) && !attemptedWithBinding.has(file)
          && Boolean(readJobPhotoPrefetchCandidate(file)?.trailingJobBinding));
      if (!next) {
        if (running.size) { await Promise.race(running); continue; }
        break;
      }
      const candidate = readJobPhotoPrefetchCandidate(next);
      if (!candidate) {
        await Promise.all(running);
        if (failure) break;
        attempted.add(next);
        attempts++;
        await process(next);
        continue;
      }
      attempted.add(next);
      // A photo held earlier in this cycle may have received its first explicit
      // trailing JK since then. Claim that newly authorized work once, without
      // delaying it through another worker sleep. Unchanged retries still wait.
      if (candidate.trailingJobBinding) attemptedWithBinding.add(next);
      attempts++;
      const task = Promise.resolve().then(() => process(next)).catch(error => { failure ||= error || new Error('Photo task failed.'); }).finally(() => running.delete(task));
      running.add(task);
    }
  } finally { await Promise.all(running); }
  if (failure) throw failure;
  return attempts;
}
