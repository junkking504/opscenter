import {crewPhoneBody,crewPhoneFailure,crewPhoneResponse} from '@/lib/crew-phone-http';
import {requireWaypointManager,withWaypointManager} from '@/lib/waypoint-manager-context';
import {WAYPOINT_MANAGER_RESOURCES,validateManagerResource,type WaypointManagerResource} from '@/lib/waypoint-manager-policy';
import {readDesktopSchedule} from '@/lib/desktop-schedule';
import {chicagoDateKey} from '@/lib/chicago-date';
import {CrewPhoneError} from '@/lib/crew-phone';
import {crewDayRoster,readCrewDay,saveCrewDay} from '@/lib/crew-phone-day';
import {JUNKWARE_DISPATCH_TRUCKS} from '@/lib/junkware-trucks';
import {pendingTruckSwitch} from '@/lib/crew-truck-switch-store';
import * as operations from '@/app/api/desktop/schedule/operations/route';
import * as creation from '@/app/api/desktop/schedule/creation/route';
import * as creationCheck from '@/app/api/desktop/schedule/creation/check/route';
import * as customers from '@/app/api/desktop/schedule/customers/route';
import * as order from '@/app/api/desktop/schedule/order/route';
import * as edit from '@/app/api/desktop/schedule/closeout/route';
import * as phones from '@/app/api/crew-phones/route';
import * as dispatch from '@/app/api/crew-dispatch/route';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=600;
const handlers:Record<WaypointManagerResource,{GET?:(r:Request)=>Promise<Response>;POST?:(r:Request)=>Promise<Response>}>=
 {operations,creation,'creation-check':creationCheck,customers,order,edit,phones,dispatch};
async function handle(request:Request){try{
 const phone=requireWaypointManager(request),url=new URL(request.url),resource=url.searchParams.get('resource') || 'schedule';
 const body=request.method==='POST'?await crewPhoneBody(request,64_000):undefined;
 if(resource==='schedule' && request.method==='GET'){
  const date=url.searchParams.get('date') || chicagoDateKey();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw new CrewPhoneError('Choose a valid date.');
  // Local snapshot only: management browsing must not launch source writes,
  // geocoding, notifications or dispatch recovery in the background.
  const snapshot=readDesktopSchedule(date);
  return crewPhoneResponse({date,observedAt:snapshot.observedAt,appointments:snapshot.appointments,
   phone,day:readCrewDay(phone),roster:crewDayRoster(),trucks:JUNKWARE_DISPATCH_TRUCKS});
 }
 if(resource==='context' && body){
  if(pendingTruckSwitch(phone.deviceId))throw new CrewPhoneError('Finish the saved truck switch before changing manager work context.',409);
  // Explicit daily attribution change, no job transfers. Standard crew routes
  // still require inspection and the exact saved crew version before closeout.
  const day=saveCrewDay(phone,body);requireWaypointManager(request);
  return crewPhoneResponse({day,message:'Work context saved. No appointments moved. Inspection and photo safeguards still apply.'});
 }
 const key=validateManagerResource(resource,request.method,body);
 const target=new URL(WAYPOINT_MANAGER_RESOURCES[key].path,url.origin);
 for(const [name,value] of url.searchParams)if(name!=='resource')target.searchParams.append(name,value);
 const delegated=new Request(target,{method:request.method,headers:request.headers,...(body?{body:JSON.stringify(body)}:{})});
 const handler=request.method==='GET'?handlers[key].GET:handlers[key].POST;
 if(!handler)throw new CrewPhoneError('Method not allowed.',405);
 // Next's tracked background work inherits the request-local identity; every
 // delegated auth check revalidates the original phone and active manager grant.
 return await withWaypointManager(request,()=>handler(delegated));
}catch(error){return crewPhoneFailure(error);}}
export const GET=handle;
export const POST=handle;
