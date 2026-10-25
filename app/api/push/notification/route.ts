import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { pushNotificationGET } from '@/lib/web-push-notification';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(request:Request) {
  return pushNotificationGET(request,await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || ''));
}
