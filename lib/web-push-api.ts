import { enablePushDevice } from './web-push-toggle';
import { pushLease } from './web-push-runtime';
import { readPushTrial } from './web-push-trial';
import { readPushJournalHealth } from './web-push-journal-health';
import type { AuthSession } from './auth';
import { opsRoleCan } from './ops-roles';
import { pushEnrollmentEnabled } from './web-push-policy';
import { pushCategories, pushSubscription } from './web-push-policy';
import { listPushDevices, managePushDevice, readPushHealth } from './web-push-store';
type PushSession=Pick<AuthSession,'email'|'role'|'expiresAt'>|null;
const headers={'Cache-Control':'private, no-store, max-age=0'};
const defaultService={enabled:pushEnrollmentEnabled,publicKey:()=>process.env.OPSCENTER_WEB_PUSH_PUBLIC_KEY,origin:()=>process.env.OPSCENTER_WEB_PUSH_ORIGIN,list:listPushDevices,manage:managePushDevice,health:readPushHealth,journal:readPushJournalHealth,trial:readPushTrial,enableDevice:enablePushDevice,sender:()=>({enabled:process.env.OPSCENTER_WEB_PUSH_ENABLED==='1',ready:pushLease('send')})};
type PushService=Omit<typeof defaultService,'health'|'journal'|'trial'|'enableDevice'|'sender'> & {health?:typeof readPushHealth;journal?:typeof readPushJournalHealth;trial?:typeof readPushTrial;enableDevice?:typeof enablePushDevice;sender?:typeof defaultService.sender};
export async function pushDevicesGET(session: PushSession, service:PushService=defaultService) {
  if(!session) return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!opsRoleCan(session.role,'sensitive.write')) return Response.json({error:'Manager access required.'},{status:403,headers});
  const journal=service.journal?{journal:await service.journal()}:{};
  try {const trial=service.trial?await service.trial(session.email):null;const enabled=service.enabled()&&!!trial?.ownerEligible&&trial.status!=='stopped';return Response.json({...journal,enabled,mode:'device-toggle',sender:service.sender?.(),publicKey:enabled?service.publicKey():null,devices:await service.list(session.email),health:service.health?await service.health():[]},{headers});}
  catch {return Response.json({...journal,enabled:false,publicKey:null,devices:[],storage:'unavailable'},{headers});}
}
export async function pushDevicesPOST(request: Request, session: PushSession, service:PushService=defaultService) {
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
    if(input.action!=='enable'||input.confirm!==true) throw new Error('Explicit device ON action required.');
    if(!service.enabled()||!service.enableDevice) return Response.json({error:'Notifications are not configured.'},{status:503,headers});
    const result=await service.enableDevice(session.email,{subscription:pushSubscription(input.subscription),categories:pushCategories(input.categories)});
    return Response.json({...result,enabled:true},{headers});
  } catch(error) {if(error instanceof Error&&error.message==='subscription_invalid')return Response.json({error:'subscription_invalid'},{status:409,headers});return Response.json({error:'Notification change could not be saved. Refresh and retry.'},{status:400,headers});}
}
