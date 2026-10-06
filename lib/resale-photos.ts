import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { mutateResaleStore, type ResalePhoto } from '@/lib/resale-items';
import { MAX_RESALE_PHOTO_BYTES, MAX_RESALE_PHOTOS, RESALE_PHOTO_TYPES } from '@/lib/resale-photo-limits';

export class ResalePhotoError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export function resalePhotoPath(photoId: string, mimeType: string): string {
  if (!/^[a-f0-9]{64}$/.test(photoId) || !RESALE_PHOTO_TYPES.includes(mimeType as typeof RESALE_PHOTO_TYPES[number])) throw new Error('Invalid resale photo.');
  return path.join(process.cwd(), 'data', 'finance', 'resale-photos', `${photoId}.${mimeType === 'image/png' ? 'png' : 'jpg'}`);
}

// Bound actual streamed bytes, including requests without Content-Length, before
// multipart parsing can allocate an unbounded body.
export async function readResalePhotoForm(request: Request): Promise<FormData> {
  const limit = MAX_RESALE_PHOTO_BYTES + 64 * 1024;
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new ResalePhotoError('Choose a JPEG or PNG photo.');
  if (Number(request.headers.get('content-length')) > limit) throw new ResalePhotoError('Photo must be 10 MB or smaller.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ResalePhotoError('Photo is required.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ResalePhotoError('Photo must be 10 MB or smaller.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData(); }
  catch { throw new ResalePhotoError('The photo upload was incomplete. Choose the file again.'); }
}

export async function attachResalePhoto(itemId: string, file: File): Promise<ResalePhoto> {
  if (!itemId || itemId.length > 200) throw new ResalePhotoError('A saved item is required.');
  if (!file.size || file.size > MAX_RESALE_PHOTO_BYTES) throw new ResalePhotoError('Photo must be between 1 byte and 10 MB.', 413);
  if (!RESALE_PHOTO_TYPES.includes(file.type as typeof RESALE_PHOTO_TYPES[number])) throw new ResalePhotoError('Use JPEG or PNG. Export HEIC photos as JPEG first.', 415);
  const original = Buffer.from(await file.arrayBuffer());
  let bytes: Buffer;
  try {
    const decoder = sharp(original, { limitInputPixels: 40_000_000, failOn: 'warning' });
    const metadata = await decoder.metadata();
    if (`image/${metadata.format === 'jpeg' ? 'jpeg' : metadata.format}` !== file.type || (metadata.pages || 1) > 1) throw new Error('Format mismatch');
    // Decode fully, orient camera photos, and strip private EXIF/GPS metadata.
    bytes = await decoder.autoOrient().toBuffer();
  } catch { throw new ResalePhotoError('This photo cannot be read. Use a valid JPEG or PNG under 40 megapixels.'); }
  if (bytes.length > MAX_RESALE_PHOTO_BYTES) throw new ResalePhotoError('Decoded photo exceeds 10 MB. Choose a smaller photo.', 413);
  // Original bytes make retries stable across decoder upgrades; item identity
  // prevents the same file from accidentally associating with another item.
  const photoId = createHash('sha256').update(itemId).update('\0').update(original).digest('hex');
  return mutateResaleStore(store => {
    const item = store.items.find(row => row.itemId === itemId);
    if (!item || item.deletedAt) throw new ResalePhotoError('Item no longer exists. Reopen the current inventory before uploading.', 404);
    const existing = item.photos?.find(photo => photo.photoId === photoId);
    if (!existing && (item.photos?.length || 0) >= MAX_RESALE_PHOTOS) throw new ResalePhotoError(`An item can have up to ${MAX_RESALE_PHOTOS} photos.`, 409);
    const target = resalePhotoPath(photoId, file.type);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const descriptor = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, target);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    if (existing) return existing;
    const photo = { photoId, mimeType: file.type, receivedAt: new Date().toISOString() };
    item.photos = [...(item.photos || []), photo];
    item.updatedAt = photo.receivedAt;
    return photo;
  });
}
