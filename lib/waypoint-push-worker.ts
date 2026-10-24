import type {Pool} from 'pg';
import {activeNotificationPhone} from './waypoint-push';
import {sendAppleWakeup,transportDependencies} from './web-push-transport';
import {chicagoDateKey} from './chicago-date';
export async function drainWaypointPush(pool:Pool,enabled:()=>boolean,send=(endpoint:string,authorize:()=>Promise<boolean>,deadline:number)=>sendAppleWakeup(endpoint,authorize,deadline,{...transportDependencies,enabled}),phones={active:activeNotificationPhone}) {
 async function allowed(row:{device_id:string;phone_id:string;truck:string;service_date:string;owner_id:string}){
  if(!enabled() || row.service_date!==chicagoDateKey())return false;
  const phone=phones.active(row.phone_id,row.truck);if(!phone)return false;
  const device=(await pool.query('SELECT enabled,owner_id,phone_id,subscription_json FROM opscenter_kernel.waypoint_push_devices WHERE id=$1',[row.device_id])).rows[0];
  return Boolean(device?.enabled && (!device.subscription_json.expirationTime || device.subscription_json.expirationTime>Date.now()) && device.phone_id===row.phone_id && device.owner_id===row.owner_id);
 }
 async function drain(){
  for(let n=0;n<1000 && enabled();n++){
   const client=await pool.connect();let row;let ids:string[]=[];
   try{await client.query('BEGIN');row=(await client.query("SELECT q.*,q.service_date::text AS service_date,d.owner_id,d.subscription_json FROM opscenter_kernel.waypoint_push_deliveries q JOIN opscenter_kernel.waypoint_push_devices d ON d.id=q.device_id WHERE q.status='pending' AND q.not_before<=now() ORDER BY q.created_at LIMIT 1 FOR UPDATE OF q SKIP LOCKED")).rows[0];
    if(!row){await client.query('COMMIT');return;}
    const valid=Date.now()-new Date(row.created_at).getTime()<5*60000 && await allowed(row);
    if(!valid){await client.query("UPDATE opscenter_kernel.waypoint_push_deliveries SET status='skipped',attempted_at=now() WHERE id=$1",[row.id]);await client.query('COMMIT');continue;}
    // Reserve every recent pending update for this exact recipient/scope before
    // one wake-up. An urgent row flushes routine changes without discarding context.
    const group=(await client.query("SELECT id FROM opscenter_kernel.waypoint_push_deliveries WHERE device_id=$1 AND phone_id=$2 AND truck=$3 AND service_date=$4 AND status='pending' AND created_at>now()-interval '5 minutes' FOR UPDATE",[row.device_id,row.phone_id,row.truck,row.service_date])).rows;
    ids=group.map(item=>item.id);
    await client.query("UPDATE opscenter_kernel.waypoint_push_deliveries SET status='sending',attempted_at=now() WHERE id=ANY($1::uuid[])",[ids]);await client.query('COMMIT');
   }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
   // A committed sending row is never replayed, including crashes before I/O.
   let result='uncertain';
   try{if(await allowed(row)){const status=await send(row.subscription_json.endpoint,()=>allowed(row),Date.now()+8000);result=status===201?'accepted':[404,410].includes(status)?'expired':'rejected';}else result='skipped';}catch{/* Uncertain sends retain their reservation. */}
   await pool.query('UPDATE opscenter_kernel.waypoint_push_deliveries SET status=$2 WHERE id=ANY($1::uuid[])',[ids,result]);
   if(result==='expired')await pool.query('UPDATE opscenter_kernel.waypoint_push_devices SET enabled=false WHERE id=$1 AND phone_id=$2 AND subscription_json=$3::jsonb',[row.device_id,row.phone_id,JSON.stringify(row.subscription_json)]);
  }
 }

 await drain();
}
