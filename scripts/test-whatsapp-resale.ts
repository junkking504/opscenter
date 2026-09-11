import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseResaleMessage, ingestResaleText, processResaleImage, resalePhotoPath } from '@/lib/whatsapp-resale';
import { readResaleStore, upsertResaleItem, deleteResaleItem } from '@/lib/resale-items';
import { parseWhatsAppWebhook, recordWhatsAppTextContext, enqueueWhatsAppImage, queuedWhatsAppImages, claimWhatsAppImage } from '@/lib/whatsapp-job-photo-queue';
import { POST } from '@/app/api/integrations/whatsapp/job-photos/route';

async function main() {
  const original = process.cwd(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'opsbot-resale-'));
  process.chdir(root);
  process.env.WHATSAPP_JOB_PHOTO_STATE_DIR = path.join(root, 'photos');
  process.env.WHATSAPP_CREW_EXPENSE_STATE_DIR = path.join(root, 'expenses');
  process.env.WHATSAPP_META_APP_SECRET = 'fixture-secret';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456';
  const text = (messageId: string, body: string, seconds = 0) => ({ messageId, senderPhone: '15555550100', phoneNumberId: '123456', receivedAt: new Date(Date.parse('2026-09-11T18:00:00Z') + seconds * 1000).toISOString(), text: body });
  try {
    assert.equal(parseResaleMessage('T1 dump $40'), null);
    assert.deepEqual(parseResaleMessage('resale\r\nOak dresser\r\n$1,200.50\r\nSOLD'), { item: 'Oak dresser', price: 1200.5, sold: true });
    for (const invalid of ['Resale\nOak dresser\n-10', 'Resale\nOak dresser\n$1,2', 'Resale\nOak dresser\n100\nmaybe', 'Resale Oak dresser 100', 'Resale\nOak dresser\n100.999']) assert.ok('error' in parseResaleMessage(invalid)!);
    // Existing records gain stable numbers without losing fields.
    fs.mkdirSync('data/finance', { recursive: true });
    fs.writeFileSync('data/finance/resale_items.json', JSON.stringify({ version: 1, updatedAt: '', items: [{ itemId: 'legacy', itemName: 'Legacy table', askingPrice: 90, status: 'listed', notes: 'original note' }] }));
    assert.equal(readResaleStore().items[0].itemNumber, 'RS-0001');
    assert.equal(readResaleStore().items[0].notes, 'original note');
    const create = text('create', 'Resale\nOak dresser\n150');
    const saved = ingestResaleText(create);
    assert.equal(saved.status, 'saved');
    assert.deepEqual(ingestResaleText(create), saved);
    const item = readResaleStore().items.find(item => item.itemName === 'Oak dresser')!;
    assert.equal(item.itemNumber, 'RS-0002');
    assert.equal(readResaleStore().items.length, 2);
    recordWhatsAppTextContext(create);
    const image = { version: 1 as const, messageId: 'image-1', senderPhone: create.senderPhone, phoneNumberId: create.phoneNumberId, receivedAt: text('', '', 1).receivedAt, caption: '', mediaId: 'media', mimeType: 'image/jpeg', sha256: '', enqueuedAt: new Date().toISOString() };
    enqueueWhatsAppImage(image);
    const bound = claimWhatsAppImage(queuedWhatsAppImages()[0])!.message;
    assert.equal(bound.matchingContext?.text, create.text);
    const jpeg = path.join(root, 'fixture.jpg'); fs.writeFileSync(jpeg, Buffer.from([255,216,255,217]));
    assert.equal((await processResaleImage(bound, async () => jpeg))?.status, 'saved');
    await processResaleImage(bound, async () => jpeg);
    let current = readResaleStore().items.find(row => row.itemId === item.itemId)!;
    assert.equal(current.photos?.length, 1);
    assert.ok(fs.existsSync(resalePhotoPath(current.photos![0].photoId, 'image/jpeg')));
    await processResaleImage({ ...bound, messageId: 'image-2' }, async () => jpeg);
    current = readResaleStore().items.find(row => row.itemId === item.itemId)!;
    assert.equal(current.photos?.length, 2);
    recordWhatsAppTextContext(text('view-label', 'Before', 2));
    enqueueWhatsAppImage({ ...image, messageId: 'view-image', receivedAt: text('', '', 3).receivedAt, caption: 'Side view' });
    const labeled = claimWhatsAppImage(queuedWhatsAppImages()[0])!.message;
    assert.equal((await processResaleImage(labeled, async () => jpeg))?.status, 'saved');
    assert.equal(readResaleStore().items.length, 2);
    upsertResaleItem({ ...current, photos: [], itemNumber: 'RS-9999', itemName: 'Oak dresser edited' });
    current = readResaleStore().items.find(row => row.itemId === item.itemId)!;
    assert.equal(current.itemNumber, 'RS-0002'); assert.equal(current.photos?.length, 3);
    const sale = text('sale', 'Resale\nRS-0002\n125\nsold', 2);
    assert.equal(ingestResaleText(sale).status, 'sold');
    ingestResaleText(sale);
    current = readResaleStore().items.find(row => row.itemId === item.itemId)!;
    assert.equal(current.soldPrice, 125); assert.equal(current.askingPrice, 150); assert.equal(current.photos?.length, 3);
    assert.equal(ingestResaleText(text('sale-again', 'Resale\nRS-0002\n15\nsold')).status, 'review');
    assert.equal(ingestResaleText(text('missing', 'Resale\nMissing table\n20\nsold')).status, 'review');
    ingestResaleText(text('same-1', 'Resale\nChair\n40'));
    ingestResaleText(text('same-2', 'Resale\nChair\n40'));
    assert.equal(ingestResaleText(text('ambiguous', 'Resale\nchair\n30\nsold')).status, 'review');
    assert.equal(ingestResaleText(text('by-name', 'Resale\nlegacy TABLE\n80\nsold')).status, 'sold');
    deleteResaleItem('legacy');
    const next = ingestResaleText(text('next', 'Resale\nLamp\n25'));
    assert.equal(next.status, 'saved');
    assert.ok(readResaleStore().items.some(row => row.itemNumber === 'RS-0005'));
    // A captured old context remains attached to its original item.
    recordWhatsAppTextContext(text('later', 'Resale\nNew sofa\n300', 3));
    await processResaleImage({ ...bound, messageId: 'image-old' }, async () => jpeg);
    assert.equal(readResaleStore().items.find(row => row.itemId === item.itemId)?.photos?.length, 4);
    assert.equal(await processResaleImage({ ...image, caption: 'JK4000123 after' }, async () => { throw new Error('Unexpected download'); }), null);
    // Signed webhook preserves caption lines and suppresses generic expense receipts.
    const payload = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '123456' }, messages: [{ id: 'webhook', from: '15555550100', timestamp: '1789149700', type: 'text', text: { body: 'Resale\nDesk\n100' } }, { id: 'caption', from: '15555550100', timestamp: '1789149701', type: 'image', image: { id: '222', mime_type: 'image/jpeg', caption: 'Resale\nDesk photo\n100' } }] } }] }] });
    const parsed = parseWhatsAppWebhook(JSON.parse(payload)); assert.equal(parsed.images[0].caption, 'Resale\nDesk photo\n100');
    const request = () => new Request('http://localhost/api/integrations/whatsapp/job-photos', { method: 'POST', body: payload, headers: { 'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', 'fixture-secret').update(payload).digest('hex')}` } });
    const response = await POST(request()); assert.equal(response.status, 200); assert.deepEqual((await response.json()).resale, ['saved']);
    const count = readResaleStore().items.length;
    assert.equal((await POST(request())).status, 200); assert.equal(readResaleStore().items.length, count);
    assert.equal((await POST(new Request('http://localhost', { method: 'POST', body: payload }))).status, 401);
    // Corruption cannot be mistaken for empty inventory and overwritten.
    fs.writeFileSync('data/finance/resale_items.json', '{broken');
    assert.throws(() => ingestResaleText(text('corrupt', 'Resale\nDo not save\n10')));
    assert.equal(fs.readFileSync('data/finance/resale_items.json', 'utf8'), '{broken');
    console.log('PASS: Resale parsing, migration, permanent numbering, photo persistence, replay, sold matching and signed webhook isolation.');
  } finally { process.chdir(original); fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
