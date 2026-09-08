import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
import {gpsRouteDate,gpsRouteTruck,readTruckGpsRoute} from '@/lib/desktop-gps-route';
import {gpsSourceVersion,readStreetRoute} from '@/lib/desktop-street-route';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store, max-age=0'};
export async function GET(request:Request){
  if(!await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || ''))return Response.json({error:'Authentication required.'},{status:401,headers});
  const params=new URL(request.url).searchParams,date=params.get('date') || '',truck=gpsRouteTruck(params.get('truck'));
  if(!gpsRouteDate(date) || !truck)return Response.json({error:'Choose a valid date and truck.'},{status:400,headers});
  const route=readTruckGpsRoute(date,truck);
  if(params.get('version')!==gpsSourceVersion(route))return Response.json({error:'GPS history changed.'},{status:409,headers});
  return Response.json(await readStreetRoute(route),{headers});
}
