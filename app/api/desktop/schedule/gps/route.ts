import {gpsSourceVersion} from '@/lib/desktop-street-route';
import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
import {gpsRouteDate,gpsRouteTruck,readTruckGpsRoute} from '@/lib/desktop-gps-route';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0'};
export async function GET(request:Request) {
  const session=await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if(!session) return Response.json({error:'Authentication required.'},{status:401,headers});
  const params=new URL(request.url).searchParams,date=params.get('date') || '',truck=gpsRouteTruck(params.get('truck'));
  if(!gpsRouteDate(date) || !truck) return Response.json({error:'Choose a valid date and truck.'},{status:400,headers});
  const route=readTruckGpsRoute(date,truck);
  return Response.json({...route,sourceVersion:gpsSourceVersion(route)},{headers});
}
