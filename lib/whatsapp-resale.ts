import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chicagoDateKey } from '@/lib/chicago-date';
import { allocateResaleNumber, mutateResaleStore, type ResaleItem, type ResaleReceipt } from '@/lib/resale-items';
import { enqueueOpsBotReply } from '@/lib/whatsapp-crew-expenses';
import { downloadWhatsAppImage } from '@/lib/whatsapp-photo-media';
import { extractJkNumber } from '@/lib/whatsapp-job-photo-matching';
import type { WhatsAppImageMessage, WhatsAppTextMessage } from '@/lib/whatsapp-job-photo-queue';

const key = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const identity = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
export function parseResaleMessage(text: string): { item: string; price: number; sold: boolean } | { error: string } | null {
  if (!/^resale\b/i.test(text.trim())) return null;
  const lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0].toLowerCase() !== 'resale' || ![3, 4].includes(lines.length) || (lines.length === 4 && lines[3].toLowerCase() !== 'sold')) {
    return { error: 'Send one line each:\nResale\nItem name or item number\nPrice\n\nAdd sold on the fourth line to record a sale.' };
  }
  if (lines[1].length > 500) return { error: "Use an item name of 500 characters or fewer. Nothing was changed." };
  const price = lines[2].replace(/^\$\s*/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(price) || Number(price.replaceAll(',', '')) > 1000000) return { error: 'Enter a valid price, such as $125 or 125.50. Nothing was changed.' };
  return { item: lines[1], price: Number(price.replaceAll(',', '')), sold: lines.length === 4 };
}

export function ingestResaleText(message: WhatsAppTextMessage, reply = true): ResaleReceipt | { status: 'ignored' } {
  const parsed = parseResaleMessage(message.text);
  if (!parsed) return { status: 'ignored' };
  const messageKey = key(`${message.phoneNumberId}:${message.senderPhone}:${message.messageId}`);
  const result = mutateResaleStore(store => {
    if (store.messages?.[messageKey]) return store.messages[messageKey];
    const remember = (receipt: ResaleReceipt) => { store.messages![messageKey] = receipt; return receipt; };
    if ('error' in parsed) return remember({ status: 'review', reply: parsed.error });
    const requestedNumber = /^(?:#?\d+|RS-\d+)$/i.test(parsed.item)
      ? `RS-${String(Number(parsed.item.replace(/^(?:RS-|#)/i, ''))).padStart(4, '0')}` : null;
    const matches = store.items.filter(item => requestedNumber ? item.itemNumber === requestedNumber : identity(item.itemName) === identity(parsed.item));
    const candidates = requestedNumber ? matches : parsed.sold ? matches.filter(item => item.status !== 'sold') : [];
    if (candidates.length > 1) return remember({ status: 'review', reply: `More than one item matches ${parsed.item}. Send its item number:\n${candidates.map(item => `${item.itemNumber} · ${item.itemName}`).join('\n')}` });
    let item: ResaleItem | undefined = candidates[0];
    if (!item && (parsed.sold || requestedNumber)) return remember({ status: 'review', reply: `No unsold item matches ${parsed.item}. Check the Resale page and send its item number. Nothing was changed.` });
    if (item?.status === 'sold') return remember({ status: 'review', reply: `${item.itemNumber} is already sold for $${item.soldPrice.toFixed(2)}. Edit the Resale page to correct a sale.` });
    const now = new Date().toISOString();
    if (!item) {
      item = { itemId: crypto.randomUUID(), itemNumber: allocateResaleNumber(store), itemName: parsed.item, acquiredDate: chicagoDateKey(new Date(message.receivedAt)), source: 'OpsBot WhatsApp', cost: 0, askingPrice: parsed.price, soldPrice: 0, status: 'to_list', marketplace: '', notes: '', photos: [], createdAt: now, updatedAt: now };
      store.items.push(item);
    }
    if (parsed.sold) {
      item.status = 'sold'; item.soldPrice = parsed.price;
      item.notes = [item.notes, `Sale reported through OpsBot on ${chicagoDateKey(new Date(message.receivedAt))}: $${parsed.price.toFixed(2)}.`].filter(Boolean).join('\n');
    } else { item.askingPrice = parsed.price; }
    item.updatedAt = now;
    return remember({ status: parsed.sold ? 'sold' : 'saved', itemId: item.itemId, reply: `${item.itemNumber} · ${item.itemName}\n${parsed.sold ? 'Sold' : 'Asking price'}: $${parsed.price.toFixed(2)}${parsed.sold ? '' : '\nSaved to Resale. Send photos next, or use this format as the photo caption.'}` });
  });
  if (reply) enqueueOpsBotReply(message, result.reply, 'resale');
  return result;
}

export function resalePhotoPath(photoId: string, mimeType: string): string {
  if (!/^[a-f0-9]{64}$/.test(photoId) || !['image/jpeg', 'image/png'].includes(mimeType)) throw new Error('Invalid resale photo.');
  return path.join(process.cwd(), 'data', 'finance', 'resale-photos', `${photoId}.${mimeType === 'image/png' ? 'png' : 'jpg'}`);
}

// Resolve the context captured at enqueue time, never a newer sender session.
export async function processResaleImage(message: WhatsAppImageMessage, download = downloadWhatsAppImage): Promise<ResaleReceipt | null> {
  const caption = parseResaleMessage(message.caption);
  const context = message.matchingContext;
  const contextText = context?.resale?.text || context?.text || '';
  const otherWorkflow = extractJkNumber(message.caption) || /^(?:t|truck)\s*\d/i.test(message.caption.trim());
  const contextual = !otherWorkflow && !context?.reviewReason && parseResaleMessage(contextText);
  if (!caption && !contextual) return null;
  const anchor = caption ? message.messageId : context?.resale?.messageId || context?.sourceMessageIds[0];
  if (!anchor) return { status: 'review', reply: 'Resale photo needs its item name or item number in the caption.' };
  const result = ingestResaleText({ ...message, messageId: anchor, text: caption ? message.caption : contextText }, false);
  if (result.status === 'ignored') return null;
  if (result.status === 'review') { enqueueOpsBotReply(message, result.reply, 'resale-review'); return result; }
  const original = await download(message);
  const mimeType = original.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const photoId = key(`${message.phoneNumberId}:${message.messageId}`);
  const target = resalePhotoPath(photoId, mimeType);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  fs.copyFileSync(original, temporary); fs.chmodSync(temporary, 0o600); fs.renameSync(temporary, target);
  const saved = mutateResaleStore(store => {
    const item = store.items.find(item => item.itemId === result.itemId);
    if (!item) return false;
    item.photos ||= [];
    if (!item.photos.some(photo => photo.photoId === photoId)) {
      item.photos.push({ photoId, mimeType, receivedAt: message.receivedAt });
      item.updatedAt = new Date().toISOString();
    }
    return true;
  });
  if (!saved) return { status: 'review', reply: 'The resale item was removed before its photo was saved. Resend with a current item number.' };
  // One item receipt per caption/context, never a receipt for each album image.
  enqueueOpsBotReply({ ...message, messageId: anchor }, result.reply, 'resale');
  return result;
}
