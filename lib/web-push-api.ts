import type { AuthSession } from './auth';
import { opsRoleCan } from './ops-roles';
import { pushEnrollmentEnabled, pushCategories, pushSubscription } from './web-push-policy';
import { listPushDevices, managePushDevice, readPushHealth } from './web-push-store';
type PushSession=Pick<AuthSession,'email'|'role'|'expiresAt'>|null;
const headers={'Cache-Control':'private, no-store, max-age=0'};
const defaultService={enabled:pushEnrollmentEnabled,publicKey:()=>process.env.OPSCENTER_WEB_PUSH_PUBLIC_KEY,origin:()=>process.env.OPSCENTER_WEB_PUSH_ORIGIN,list:listPushDevices,manage:managePushDevice,health:readPushHealth};
export async function pushDevicesGET(session: PushSession, service:Omit<typeof defaultService,'health'> & {health?:typeof readPushHealth}=defaultService) {
  if(!session) return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!opsRoleCan(session.role,'sensitive.write')) return Response.json({error:'Manager access required.'},{status:403,headers});
  try {return Response.json({enabled:service.enabled(),publicKey:service.enabled()?service.publicKey():null,devices:await service.list(session.email),health:service.health?await service.health():[]},{headers});}
  catch {return Response.json({enabled:false,publicKey:null,devices:[],storage:'unavailable'},{headers});}
}
export async function pushDevicesPOST(request: Request, session: PushSession, service:Omit<typeof defaultService,'health'> & {health?:typeof readPushHealth}=defaultService) {
  if(!session) return Response.json({error:'Authentication required.'},{status:401,headers});
  // Explicit trusted deployment origin, not client-controlled forwarding headers.
  const origin=service.origin();
  if(!opsRoleCan(session.role,'sensitive.write') || !origin || request.headers.get('origin')!==origin || request.headers.get('sec-fetch-site')==='cross-site') return Response.json({error:'Manager access and a same-origin request are required.'},{status:403,headers});
  try {
    const reader=request.body?.getReader(); if(!reader) throw new Error('Missing input.');
    const chunks:Uint8Array[]=[];let bytes=0;
    for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>8192){await reader.cancel();return Response.json({error:'Request too large.'},{status:413,headers});}chunks.push(part.value);}
    const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(input.action==='unsubscribe') {
      if(typeof input.deviceId!=='string' || !/^[a-f0-9-]{36}$/.test(input.deviceId)) throw new Error('Invalid device.');
      await service.manage(session.email,{action:'unsubscribe',deviceId:input.deviceId,expiresAt:session.expiresAt});
      return Response.json({ok:true},{headers});
    }
    if(input.action!=='subscribe') throw new Error('Invalid action.');
    if(!service.enabled()) return Response.json({error:'Notifications have not been activated.'},{status:503,headers});
    const subscription=pushSubscription(input.subscription),categories=pushCategories(input.categories);
    const expiresAt=new Date(Math.min(session.expiresAt.getTime(),Date.now()+30*86400000,subscription.expirationTime || Infinity));
    const deviceId=await service.manage(session.email,{action:'subscribe',subscription,categories,expiresAt});
    return Response.json({deviceId,expiresAt},{headers});
  } catch {return Response.json({error:'Notification change could not be saved. Refresh and retry.'},{status:400,headers});}
}
