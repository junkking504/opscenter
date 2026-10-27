import type { AuthSession } from './auth';
import { opsRoleCan } from './ops-roles';
import { getKernelPool } from './platform/persistence/pool';
import { pushMessage } from './web-push-message';
import { alertTruck, truckMapHref } from './alert-destination';

type Receipt={notification_json:unknown;category:string;occurred_at:Date|string};
export async function readPushNotification(owner:string,id:string):Promise<Receipt|null> {
  const result=await getKernelPool().query(`SELECT e.notification_json,e.category,e.occurred_at
    FROM opscenter_kernel.push_events e
    WHERE e.id=$1 AND EXISTS (SELECT 1 FROM opscenter_kernel.push_deliveries q
      JOIN opscenter_kernel.push_devices d ON d.id=q.device_id
      WHERE q.event_id=e.id AND d.owner_id=$2 AND q.attempted_at IS NOT NULL)
    LIMIT 1`,[id,owner]);
  return result.rows[0] || null;
}
export async function pushNotificationGET(request:Request,session:Pick<AuthSession,'email'|'role'>|null,read=readPushNotification) {
  const headers={'Cache-Control':'private, no-store, max-age=0'};
  if(!session)return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!opsRoleCan(session.role,'sensitive.write'))return Response.json({error:'Manager access required.'},{status:403,headers});
  const id=new URL(request.url).searchParams.get('id') || '';
  if(!/^[a-f0-9]{64}$/.test(id))return Response.json({error:'Invalid notification.'},{status:400,headers});
  try {
    const row=await read(session.email,id),message=row && pushMessage(row.notification_json);
    if(!row || !message)return Response.json({error:'Notification unavailable.'},{status:404,headers});
    const occurredAt=new Date(row.occurred_at).toISOString();
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date(occurredAt));
    const truck=alertTruck(message.title);
    const path=message.path || (row.category==='fleet' && truck ? truckMapHref(truck,date) : row.category==='krewe' ? '/desktop?'+new URLSearchParams({workspace:'Krewe',kreweView:'today',date,focus:'record'}) : undefined);
    return Response.json({...message,path,occurredAt},{headers});
  } catch {return Response.json({error:'Notification unavailable.'},{status:503,headers});}
}
