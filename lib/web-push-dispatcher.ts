import { retainPushMetadata } from './web-push-retention';
import { Client } from 'pg';
import { resolveKernelDatabaseConfig } from './platform/persistence/config';
import { pushEnabled } from './web-push-policy';
import { drainPushOutbox, pushDependencies, PUSH_LOCK, pushErrorCode, type PushWorkerDependencies } from './web-push-worker';
/** One dedicated connection owns LISTEN and leadership. Connection loss stops
 * new claims; the process exits for supervisor restart, never returns it to a pool. */
export async function startPushDispatcher(deps?:PushWorkerDependencies, suppliedListener?:Client, onFailure:()=>void=()=>{}) {
  if(!deps && !pushEnabled())return {disabled:true,stop:async()=>{}};
  const d=deps||pushDependencies();
  if(!d.enabled())return {disabled:true,stop:async()=>{}};
  const config=suppliedListener?null:resolveKernelDatabaseConfig();
  if(!suppliedListener && config?.status!=='ready')throw new Error('push_database_unavailable');
  const listener=suppliedListener||new Client({connectionString:config?.status==='ready'?config.connectionString:undefined,connectionTimeoutMillis:5000,application_name:'opscenter-push-listener'});
  let alive=true,ready=false,again=false,draining:Promise<void>|null=null;
  const guarded={...d,enabled:()=>alive&&d.enabled()};
  const stop=async()=>{alive=false;await listener.end().catch(()=>{});await draining;};
  const fail=()=>{if(!alive)return;alive=false;void listener.end().catch(()=>{});onFailure();};
  listener.on('error',fail);listener.on('end',fail);
  const wake=()=>{
    again=true;if(draining||!alive||!ready)return;
    draining=(async()=>{do{again=false;await drainPushOutbox(guarded);}while(again&&alive);})()
      .catch(error=>{console.error(`Web Push dispatcher: ${pushErrorCode(error)}`);fail();})
      .finally(()=>{draining=null;if(again&&alive)wake();});
  };
  try {
    await listener.connect();
    const lock=await listener.query('SELECT pg_try_advisory_lock($1) AS locked',[PUSH_LOCK]);
    if(!lock.rows[0].locked){await stop();return {busy:true,stop};}
    listener.on('notification',notice=>{if(notice.channel==='opscenter_web_push')wake();});
    await listener.query('LISTEN opscenter_web_push');
    await listener.query("UPDATE opscenter_kernel.push_deliveries SET status='uncertain',reason='process_interrupted' WHERE status='sending'");
    await retainPushMetadata(listener);
    if(!alive)throw new Error('listener_lost');
    ready=true;wake();
    return {stop,get active(){return alive;}};
  }catch(error){await stop();throw error;}
}
