import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
import {googleTile,googleViewport,validTile,validViewport} from '@/lib/google-map-tiles';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request) {
  if(!await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || ''))return Response.json({error:'Authentication required.'},{status:401,headers});
  const params=new URL(request.url).searchParams;
  if(params.get('kind')==='tile'){
    const tile=validTile(params);if(!tile)return Response.json({error:'Invalid tile.'},{status:400,headers});
    const data=await googleTile(tile);
    return data?new Response(new Uint8Array(data),{headers:{...headers,'Content-Type':'image/png'}}):Response.json({error:'Street map unavailable.'},{status:503,headers});
  }
  const viewport=params.get('kind')==='viewport'?validViewport(params):null;
  if(!viewport)return Response.json({error:'Invalid viewport.'},{status:400,headers});
  const data=await googleViewport(viewport);
  return Response.json(data || {error:'Street map unavailable.'},{status:data?200:503,headers});
}
