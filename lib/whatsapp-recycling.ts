import fs from 'node:fs';
import path from 'node:path';
import { downloadWhatsAppImage } from './whatsapp-photo-media';
import { enqueueOpsBotReply } from './whatsapp-crew-expenses';
import type { WhatsAppImageMessage, WhatsAppTextMessage } from './whatsapp-job-photo-queue';
import { appendRecyclingReceiptPhoto, readRecyclingData, recyclingPhotoPath, recyclingVersion } from './recycling-receipt-store';
import { parseRecyclingOcr, recognizeRecyclingReceipt } from './recycling-receipt-ocr';
export const isRecyclingMessage = (text: string) => /^recycling(?:\s|$)/i.test(text.trim());
export function ingestRecyclingText(message: WhatsAppTextMessage) {
  if (!isRecyclingMessage(message.text)) return { status: 'ignored' as const };
  enqueueOpsBotReply(message, 'Send receipt photos next, within 10 minutes. Send Recycling again before a different receipt. Photos will appear in Finance → Recycling for review; no income is recorded until you confirm the breakdown.', 'recycling-intake');
  return { status: 'review' as const };
}
export async function processRecyclingImage(message: WhatsAppImageMessage, download = downloadWhatsAppImage, recognize = recognizeRecyclingReceipt, reply = true) {
  const explicit = isRecyclingMessage(message.caption);
  const context = message.matchingContext;
  const inherited = !message.caption.trim() && !context?.reviewReason && context?.recycling;
  if (!explicit && !inherited) return null;
  const anchor = explicit ? message.messageId : inherited && inherited.messageId;
  if (!anchor) return null;
  const id = recyclingVersion(`${message.phoneNumberId}:${message.senderPhone}:${anchor}`);
  const photoId = recyclingVersion(`${message.phoneNumberId}:${message.messageId}`);
  const prior = readRecyclingData().receiptDrafts?.find(draft => draft.photos.some(photo => photo.photoId === photoId));
  if (prior) return { status: 'review' as const, draftId: prior.id };
  const original = await download(message);
  const mimeType = original.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const target = recyclingPhotoPath(photoId, mimeType); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.copyFileSync(original, target); fs.chmodSync(target, 0o600);
  let parsed: ReturnType<typeof parseRecyclingOcr>;
  try { parsed = parseRecyclingOcr(await recognize(target)); }
  catch { parsed = { text: '', rows: [], total: null, yard: '', warnings: ['Text recognition could not complete. The original photo is saved for manual review.'] }; }
  const draft = appendRecyclingReceiptPhoto(id, { photoId, mimeType, receivedAt: message.receivedAt, text: parsed.text, rows: parsed.rows, total: parsed.total, warnings: parsed.warnings }, parsed.yard);
  if (reply) enqueueOpsBotReply(message, `Recycling receipt saved: ${draft.photos.length} photo(s), ${draft.rows.length} extracted line(s). Review the dates, tickets, amounts and payment date in Finance → Recycling before recording daily runs.`, 'recycling-photo');
  return { status: 'review' as const, draftId: draft.id };
}
