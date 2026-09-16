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

export type BatchResult = { results: ({ filePath: string; status: 'verified'; verification: PhotoUploadResult } | { filePath: string; status: 'uncertain'; error: string })[] };
type Pending = { input: PhotoUploadInput; bytes: number; resolve: (result: PhotoUploadResult) => void; reject: (error: Error) => void };
const GROUP_BYTES = Math.floor(4.5 * 1024 * 1024);
const sameTarget = (a: PhotoUploadInput, b: PhotoUploadInput) => a.appointmentId === b.appointmentId && a.jkNumber === b.jkNumber && a.category === b.category;

type UploadBatch = (inputs: PhotoUploadInput[]) => Promise<BatchResult>;

/** Independent uploader sessions overlap only for the same exact job/category. */
export function createPhotoUploadBatchQueue(upload: UploadBatch | UploadBatch[], options: {
  prepare?: (input: PhotoUploadInput) => Promise<void>;
  finalize?: (inputs: PhotoUploadInput[], result: BatchResult) => Promise<BatchResult>;
} = {}) {
  const lanes = Array.isArray(upload) ? [...upload] : [upload];
  if (!lanes.length || lanes.length > 3) throw new Error('Photo batching requires one to three independent upload lanes.');
  const pending: Pending[] = [];
  const running = new Map<number, Promise<void>>();
  let epoch: { target: PhotoUploadInput; items: Pending[]; results: BatchResult['results'] } | undefined;
  let finalizing: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, closed = false, started = false;
  let preparation: Promise<void> | undefined, preparationTarget: PhotoUploadInput | undefined;
  let preparationDone = !options.prepare, initialWindowDone = !options.prepare;
  let initialWindow: Promise<void> | undefined, finishInitialWindow: (() => void) | undefined;
  let preparationFailure: Error | undefined;

  function prepare(input: PhotoUploadInput) {
    if (!options.prepare || preparation) return;
    preparationTarget = input;
    initialWindow = new Promise<void>(resolve => { finishInitialWindow = resolve; });
    preparation = Promise.resolve().then(() => options.prepare!(input)).catch(error => {
      preparationFailure = error instanceof Error ? error : new Error(String(error));
      for (let index = pending.length - 1; index >= 0; index--) {
        if (sameTarget(input, pending[index].input)) pending.splice(index, 1)[0].reject(preparationFailure);
      }
    }).finally(() => { preparationDone = true; pump(); });
  }

  function takeGroup(): Pending[] {
    const group = [pending.shift()!];
    let bytes = group[0].bytes;
    // Keep the oldest ready photo first and fill spare capacity without crossing
    // a different job/category. Original files are read, never transformed.
    for (let index = 0; index < pending.length && group.length < 5;) {
      if (!sameTarget(group[0].input, pending[index].input)) break;
      if (bytes + pending[index].bytes > GROUP_BYTES) { index++; continue; }
      const [next] = pending.splice(index, 1); group.push(next); bytes += next.bytes;
    }
    return group;
  }
  function exactResult(item: Pending, result: BatchResult): BatchResult['results'][number] {
    const matches = (Array.isArray(result?.results) ? result.results : []).filter(row => row?.filePath === item.input.filePath);
    return matches.length === 1 ? matches[0] : { filePath: item.input.filePath, status: 'uncertain', error: 'JunkWare did not verify this exact photo.' };
  }
  function settle(item: Pending, result: BatchResult['results'][number]) {
    if (result.status === 'verified') item.resolve(result.verification);
    else item.reject(new Error(result.error));
  }
  async function submit(lane: UploadBatch, group: Pending[]) {
    let result: BatchResult;
    try { result = await lane(group.map(item => item.input)); }
    catch (error) {
      // A rejected callback might have submitted. Never retry the group.
      const detail = error instanceof Error ? error.message : String(error);
      result = { results: group.map(item => ({ filePath: item.input.filePath, status: 'uncertain', error: detail })) };
    }
    for (const item of group) {
      const row = exactResult(item, result);
      if (options.finalize) { epoch!.items.push(item); epoch!.results.push(row); }
      else settle(item, row);
    }
  }
  function finishEpoch() {
    const finished = epoch!;
    finalizing = Promise.resolve().then(async () => {
      try {
        const audited = await options.finalize!(finished.items.map(item => item.input), { results: finished.results });
        for (let index = 0; index < finished.items.length; index++) {
          const original = finished.results[index];
          // A final gallery cannot turn an uncertain POST into an automatic
          // success. Its existing reconciliation policy remains authoritative.
          settle(finished.items[index], original.status === 'uncertain' ? original : exactResult(finished.items[index], audited));
        }
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        for (const item of finished.items) item.reject(failure);
      }
    }).finally(() => { epoch = undefined; finalizing = undefined; pump(); });
  }
  function pump() {
    // Do not freeze a group while lazy browser authentication is still running.
    if (!preparationDone || !initialWindowDone) return;
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (finalizing) return;
    if (epoch && !running.size && (!pending.length || !sameTarget(epoch.target, pending[0].input))) {
      if (options.finalize) { finishEpoch(); return; }
      epoch = undefined;
    }
    if (!pending.length) return;
    epoch ||= { target: pending[0].input, items: [], results: [] };
    started = true;
    for (let index = 0; index < lanes.length && pending.length; index++) {
      if (running.has(index)) continue;
      // Another target waits for every active writer and the final source audit.
      if (!sameTarget(epoch.target, pending[0].input)) break;
      const group = takeGroup();
      const task = Promise.resolve().then(() => submit(lanes[index], group)).finally(() => {
        running.delete(index);
        pump();
      });
      running.set(index, task);
    }
  }
  function schedule() {
    if (!preparationDone && initialWindowDone) return;
    if (!timer && !finalizing && running.size < lanes.length) timer = setTimeout(() => {
      timer = undefined;
      initialWindowDone = true;
      finishInitialWindow?.();
      pump();
    }, started ? 100 : 500);
  }
  return {
    upload(input: PhotoUploadInput): Promise<PhotoUploadResult> {
      if (closed) return Promise.reject(new Error('Photo upload batching is closed.'));
      if (preparationFailure && preparationTarget && sameTarget(preparationTarget, input)) return Promise.reject(preparationFailure);
      try {
        const stat = fs.lstatSync(input.filePath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > 5 * 1024 * 1024) throw new Error('Photo size is outside the verified upload limits.');
        return new Promise((resolve, reject) => { pending.push({ input, bytes: stat.size, resolve, reject }); prepare(input); schedule(); });
      } catch (error) { return Promise.reject(error); }
    },
    async close() {
      closed = true;
      await Promise.all([preparation, initialWindow]);
      pump();
      while (running.size || finalizing) await Promise.all([...running.values(), ...(finalizing ? [finalizing] : [])]);
    },
  };
}

/** Only uncomplicated explicit-JK photos overlap; alternate workflows stay serial. */
export async function drainConcurrentPhotoQueue(process: (file: string) => Promise<void>, limit = 100, concurrency = 32): Promise<number> {
  const attempted = new Set<string>();
  const attemptedWithBinding = new Set<string>();
  let attempts = 0;
  const running = new Set<Promise<void>>();
  const cap = Math.min(100, Math.max(0, Math.floor(limit)));
  const lanes = Math.min(32, Math.max(1, Math.floor(concurrency)));
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
