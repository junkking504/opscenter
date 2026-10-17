import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthSession } from './auth';
import { CrewPhoneError } from './crew-phone';
import { requireCrewPhone } from './crew-phone-http';
import { crewIsWaypointManager } from './crew-appointment-visibility';

// Internal handler delegation only. No token, cookie, role binding or client
// header can create this context. Other OpsCenter handlers never consult it.
const context=new AsyncLocalStorage<{request:Request;deviceId:string}>();
const routes=new Map<string,readonly string[]>([
 ['/api/desktop/schedule/operations',['GET','POST']],
 ['/api/job-route-assignments',['POST']],['/api/job-cancellation',['POST']],
 ['/api/junkware-appointment-note',['POST']],['/api/job-call-ahead',['POST']],
 ['/api/desktop/schedule/classification',['POST']],
 ['/api/desktop/schedule/creation',['GET','POST']],
 ['/api/desktop/schedule/creation/check',['POST']],
 ['/api/desktop/schedule/customers',['POST']],
 ['/api/desktop/schedule/order',['POST']],
 ['/api/job-closeout',['GET','POST']],
 ['/api/desktop/schedule/closeout',['GET']],
 ['/api/crew-dispatch',['GET','POST']],['/api/crew-phones',['GET','POST']],
]);
export function requireWaypointManager(request:Request){
 const phone=requireCrewPhone(request);
 if(!crewIsWaypointManager(phone))throw new CrewPhoneError('Waypoint manager access is required.',403);
 return phone;
}
export function withWaypointManager<T>(request:Request,run:()=>T):T {
 const phone=requireWaypointManager(request);
 return context.run({request,deviceId:phone.deviceId},run);
}
export function waypointManagerActor(request:Request):AuthSession|null {
 const saved=context.getStore();
 if(!saved || !routes.get(new URL(request.url).pathname)?.includes(request.method))return null;
 const phone=requireWaypointManager(saved.request);
 if(phone.deviceId!==saved.deviceId)throw new CrewPhoneError('Manager access changed. Refresh Waypoint.',403);
 return {email:`waypoint-manager:${phone.deviceId}`,role:'manager',issuedAt:new Date(phone.enrolledAt),expiresAt:new Date(phone.expiresAt)};
}
