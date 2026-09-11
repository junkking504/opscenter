import fs from 'node:fs';
import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { readRecyclingData, recyclingPhotoPath } from '@/lib/recycling-receipt-store';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ photoId: string }> }) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor || !opsRoleCan(actor.role, 'finance.read')) return new Response('Finance access required.', { status: actor ? 403 : 401, headers });
  const { photoId } = await context.params;
  const photo = readRecyclingData().receiptDrafts?.flatMap(draft => draft.photos).find(photo => photo.photoId === photoId);
  if (!photo) return new Response('Photo not found.', { status: 404, headers });
  try { return new Response(fs.readFileSync(recyclingPhotoPath(photo.photoId, photo.mimeType)), { headers: { ...headers, 'Content-Type': photo.mimeType } }); }
  catch { return new Response('Photo unavailable.', { status: 404, headers }); }
}
