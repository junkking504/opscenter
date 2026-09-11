import fs from 'node:fs';
import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { readResaleStore } from '@/lib/resale-items';
import { resalePhotoPath } from '@/lib/whatsapp-resale';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ photoId: string }> }) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '')) return new Response('Authentication required.', { status: 401, headers });
  const { photoId } = await context.params;
  const photo = readResaleStore().items.flatMap(item => item.photos || []).find(photo => photo.photoId === photoId);
  if (!photo) return new Response('Photo not found.', { status: 404, headers });
  try { return new Response(fs.readFileSync(resalePhotoPath(photo.photoId, photo.mimeType)), { headers: { ...headers, 'Content-Type': photo.mimeType } }); }
  catch { return new Response('Photo unavailable.', { status: 404, headers }); }
}
