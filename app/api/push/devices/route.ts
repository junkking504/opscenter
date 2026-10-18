import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { pushDevicesGET, pushDevicesPOST } from '@/lib/web-push-api';
export const dynamic='force-dynamic';
export const runtime='nodejs';
async function actor() {return verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');}
export async function GET() {return pushDevicesGET(await actor());}
export async function POST(request:Request) {return pushDevicesPOST(request,await actor());}
