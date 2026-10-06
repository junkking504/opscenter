import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { resaleTestRoutes } from './resale-photo-test-support';
import { readResaleStore, upsertResaleItem } from '../lib/resale-items';
import { attachResalePhoto, resalePhotoPath } from '../lib/resale-photos';
import { commercialVersion } from '../lib/desktop-marketing';
import type { CommercialOperation } from '../desktop-ui/lib/commercial-contract';
import { ingestResaleText, processResaleImage } from '../lib/whatsapp-resale';

async function main() {
  const original = process.cwd(), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'resale-delete-'));
  const routes = resaleTestRoutes(); process.chdir(temporary);
  const current = () => readResaleStore(true).items.find(item => item.itemId === 'fixture-item')!;
  const operation = (action: 'resale.delete' | 'resale.restore'): CommercialOperation => ({ action, requestId: randomUUID(), date: '2026-10-06', recordId: 'fixture-item', expectedVersion: commercialVersion(current()), values: {} });
  const send = (op: CommercialOperation, origin = 'http://localhost') => routes.finance.POST(new Request('http://localhost/api/desktop/finance', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(op) }));
  try {
    upsertResaleItem({ itemId: 'fixture-item', itemName: 'Synthetic sold cabinet', source: 'Fixture source 123', acquiredDate: '2026-10-06', status: 'sold', cost: 20, askingPrice: 80, soldPrice: 65, marketplace: 'Fixture market', notes: 'Fixture sale evidence' });
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).jpeg().toBuffer();
    const photo = await attachResalePhoto('fixture-item', new File([new Uint8Array(bytes)], 'fixture.jpg', { type: 'image/jpeg' }));
    const before = current(), deletion = operation('resale.delete');
    const legacyDelete = () => routes.legacy.DELETE(new Request('http://localhost/api/resale-items?itemId=fixture-item', { method: 'DELETE', headers: { origin: 'http://localhost' } }));
    assert.equal((await legacyDelete()).status, 409); assert.equal(current().deletedAt, undefined);
    routes.session.signedIn = false; assert.equal((await legacyDelete()).status, 401); assert.equal((await send(deletion)).status, 401);
    routes.session.signedIn = true;
    for (const role of ['operator']) { routes.session.role = role; assert.equal((await legacyDelete()).status, 403); assert.equal((await send(deletion)).status, 403); }
    routes.session.role = 'manager'; assert.equal((await send(deletion, 'https://wrong.example')).status, 403);
    assert.equal(current().deletedAt, undefined);
    assert.equal((await send({ ...deletion, expectedVersion: '0'.repeat(64) })).status, 409);
    assert.equal((await send(deletion)).status, 200);
    assert.equal(readResaleStore().items.length, 0); assert.equal(readResaleStore(true).items.length, 1);
    const deleted = current(); assert(deleted.deletedAt); assert.equal(deleted.deletedBy, 'fixture-manager');
    for (const field of ['itemNumber', 'source', 'photos', 'cost', 'soldPrice', 'notes', 'status', 'createdAt'] as const) assert.deepEqual(deleted[field], before[field]);
    assert(fs.existsSync(resalePhotoPath(photo.photoId, photo.mimeType)));
    const snapshot = fs.readFileSync('data/finance/resale_items.json', 'utf8');
    assert.equal((await send(deletion)).status, 200); assert.equal(fs.readFileSync('data/finance/resale_items.json', 'utf8'), snapshot, 'Lost response replay is a no-op');
    assert.equal((await send({ ...deletion, action: 'resale.restore' })).status, 409);
    await assert.rejects(attachResalePhoto('fixture-item', new File([new Uint8Array(bytes)], 'fixture.jpg', { type: 'image/jpeg' })));
    assert.throws(() => upsertResaleItem(before), /Restore/);
    const receipt = await routes.finance.GET(new Request(`http://localhost/api/desktop/finance?date=2026-10-06&receipt=${deletion.requestId}`));
    assert.equal(receipt.status, 200); assert.equal((await receipt.json()).receipt.status, 'verified');
    const restoration = operation('resale.restore'); assert.equal((await send(restoration)).status, 200);
    assert.equal(current().deletedAt, undefined); assert.deepEqual(current().photos, before.photos);
    assert.equal((await send(deletion)).status, 200); assert.equal(current().deletedAt, undefined, 'Old deletion receipt cannot delete a restored item');
    assert.equal(Object.keys(readResaleStore(true).lifecycleReceipts!).length, 2);
    const next = operation('resale.delete');
    const rename = fs.renameSync;
    fs.renameSync = ((from, to) => { if (String(to).endsWith('resale_items.json')) throw new Error('Fixture write failure'); return rename(from, to); }) as typeof fs.renameSync;
    try { assert.equal((await send(next)).status, 503); } finally { fs.renameSync = rename; }
    assert.equal(current().deletedAt, undefined); assert.equal(readResaleStore(true).lifecycleReceipts?.[next.requestId], undefined);
    assert.equal((await send(next)).status, 200);
    const result = ingestResaleText({ messageId: 'fixture-sale', phoneNumberId: 'fixture', senderPhone: 'fixture', receivedAt: '2026-10-06T12:00:00Z', text: `Resale\n${before.itemNumber}\n75\nsold` }, false);
    assert.equal(result.status, 'review'); assert.equal(current().soldPrice, 65);
    // Every writer must preserve another item's deletion and lifecycle receipts.
    const retained = current(), receipts = readResaleStore(true).lifecycleReceipts;
    upsertResaleItem({ ...before, itemId: 'other-item', status: 'to_list', soldPrice: 0 });
    await attachResalePhoto('other-item', new File([new Uint8Array(bytes)], 'other.jpg', { type: 'image/jpeg' }));
    const text = { messageId: 'worker-anchor', phoneNumberId: 'fixture', senderPhone: 'fixture', receivedAt: '2026-10-06T12:00:00Z', text: 'Resale\nSynthetic worker item\n25' };
    const workerItem = ingestResaleText(text, false);
    assert(workerItem.status === 'saved' && workerItem.itemId);
    assert.deepEqual(current(), retained); assert.deepEqual(readResaleStore(true).lifecycleReceipts, receipts);
    const workerRow = readResaleStore().items.find(item => item.itemId === workerItem.itemId)!;
    const workerDelete: CommercialOperation = { ...operation('resale.delete'), recordId: workerRow.itemId, expectedVersion: commercialVersion(workerRow) };
    const originalImage = path.join(temporary, 'worker.jpg'); fs.writeFileSync(originalImage, bytes);
    const filesBefore = fs.readdirSync('data/finance/resale-photos');
    const imageResult = await processResaleImage({ version: 1, ...text, caption: text.text, mediaId: 'fixture', mimeType: 'image/jpeg', sha256: '', enqueuedAt: text.receivedAt }, async () => {
      assert.equal((await send(workerDelete)).status, 200);
      return originalImage;
    });
    assert.equal(imageResult?.status, 'review');
    assert.deepEqual(fs.readdirSync('data/finance/resale-photos'), filesBefore, 'Deletion during download must not publish an orphan photo');
    assert.deepEqual(current(), retained);
    fs.writeFileSync('data/finance/resale_items.json.lock', 'fixture'); assert.equal((await send(operation('resale.restore'))).status, 503); fs.unlinkSync('data/finance/resale_items.json.lock');
    const validStore = readResaleStore(true);
    fs.writeFileSync('data/finance/resale_items.json', JSON.stringify({ ...validStore, lifecycleReceipts: [] }));
    assert.equal((await send(restoration)).status, 503);
    fs.writeFileSync('data/finance/resale_items.json', '{broken'); assert.equal((await send(restoration)).status, 503); assert.equal(fs.readFileSync('data/finance/resale_items.json', 'utf8'), '{broken');
    console.log('PASS: delete/restore authorization, origin, stale version, attributed atomic receipts, repeat/lost-response retry, financial/photo retention, resurrection guard, failed writes, worker rejection, locks and corruption.');
  } finally { process.chdir(original); fs.rmSync(temporary, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
