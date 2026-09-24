import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { subscribeWhatsAppPhotoUpdates } from '../lib/whatsapp-photo-update-stream';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opscenter-photo-stream-'));
  const previous = process.env.WHATSAPP_JOB_PHOTO_STATE_DIR;
  delete process.env.WHATSAPP_JOB_PHOTO_STATE_DIR;
  const directory = path.join(root, 'integrations', 'whatsapp-job-photos', 'completed');
  fs.mkdirSync(directory, { recursive: true });
  const unsubscribers: Array<() => void> = [];
  try {
    let first = 0, second = 0;
    let resolveChange!: () => void;
    const changed = new Promise<void>(resolve => { resolveChange = resolve; });
    unsubscribers.push(subscribeWhatsAppPhotoUpdates(root, () => { first++; }));
    unsubscribers.push(subscribeWhatsAppPhotoUpdates(root, () => { second++; resolveChange(); }));
    // Darwin can acknowledge fs.watch creation before its kernel stream is
    // ready. Let that one-time subscription handshake settle before testing
    // the receipt event; production also performs an initial gallery read.
    await new Promise(resolve => setTimeout(resolve, 20));
    const target = path.join(directory, `${'a'.repeat(64)}.json`);
    fs.writeFileSync(`${target}.tmp`, '{}');
    fs.renameSync(`${target}.tmp`, target);
    await Promise.race([changed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Photo event exceeded two seconds')), 2_000); timer.unref(); })]);
    assert.ok(first > 0 && second > 0, 'An atomic completed receipt wakes every connected gallery');
    unsubscribers[0]();
    const firstAfterClose = first;
    const secondAfterClose = second;
    const next = new Promise<void>(resolve => { resolveChange = resolve; });
    fs.writeFileSync(path.join(directory, `${'b'.repeat(64)}.json`), '{}');
    await Promise.race([next, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Remaining subscriber lost its watcher')), 2_000); timer.unref(); })]);
    assert.equal(first, firstAfterClose);
    assert.ok(second > secondAfterClose);
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
    if (previous === undefined) delete process.env.WHATSAPP_JOB_PHOTO_STATE_DIR;
    else process.env.WHATSAPP_JOB_PHOTO_STATE_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('Verified photo receipt publication immediately wakes connected galleries');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
