import {requireCrewPhone,crewPhoneResponse,crewPhoneFailure} from '@/lib/crew-phone-http';
import {waypointAppleMapsConfig} from '@/lib/waypoint-apple-maps-config';
export const runtime='nodejs';
export const dynamic='force-dynamic';
/** Map provider for an enrolled Waypoint phone. The token is a website-restricted browser token. */
export async function GET(request:Request){
  try{requireCrewPhone(request);return crewPhoneResponse(waypointAppleMapsConfig());}
  catch(error){return crewPhoneFailure(error);}
}
