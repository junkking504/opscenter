import {requireCrewPhone,crewPhoneBody,crewPhoneFailure,crewPhoneResponse} from '@/lib/crew-phone-http';
import {requireCrewDay} from '@/lib/crew-phone-day';
import {waypointUpdates,manageWaypointPush,waypointMessages,waypointPushReady,waypointNotificationStatus} from '@/lib/waypoint-push';
export const runtime='nodejs';export const dynamic='force-dynamic';
function phone(request:Request){const p=requireCrewPhone(request);if(p.test)throw new Error('Test phones cannot enable live notifications.');requireCrewDay(p);return p;}
export async function GET(request:Request){try{const p=phone(request);return crewPhoneResponse({available:waypointPushReady(),publicKey:waypointPushReady()?process.env.OPSCENTER_WEB_PUSH_PUBLIC_KEY:null,messages:await waypointMessages(p.truck),updates:await waypointUpdates(p),...await waypointNotificationStatus(p,request.headers.get('x-waypoint-notification-key'),request.headers.get('x-waypoint-notification-device'))});}catch(e){return crewPhoneFailure(e);}}
export async function POST(request:Request){try{const p=phone(request),body=await crewPhoneBody(request,8192);return crewPhoneResponse(await manageWaypointPush(p,body));}catch(e){return crewPhoneFailure(e);}}
