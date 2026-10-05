import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { attachResalePhoto, readResalePhotoForm, ResalePhotoError } from '@/lib/resale-photos';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
export async function POST(request: Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(actor.role, 'sensitive.write')) return Response.json({ error: 'This role cannot change these records.' }, { status: 403, headers });
  if (!isDesktopWriteOriginAllowed(request)) return Response.json({ error: 'Same-origin request required.' }, { status: 403, headers });
  try {
    const form = await readResalePhotoForm(request);
    const file = form.get('photo'), itemId = form.get('itemId');
    if (!(file instanceof File) || typeof itemId !== 'string' || form.getAll('photo').length !== 1 || form.getAll('itemId').length !== 1) throw new ResalePhotoError('Select one photo and a saved item.');
    const photo = await attachResalePhoto(itemId, file);
    return Response.json({ ok: true, photo }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof ResalePhotoError ? error.message : 'Photo could not be confirmed. Retry the same file safely.' }, { status: error instanceof ResalePhotoError ? error.status : 503, headers });
  }
}
