import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store, max-age=0'};
// Retired Google endpoint: stale browser sessions must not generate provider usage.
export async function GET(){
  if(!await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || ''))return Response.json({error:'Authentication required.'},{status:401,headers});
  return Response.json({error:'Street matching is disabled. Reload OpsCenter to view recorded GPS history.'},{status:410,headers});
}
