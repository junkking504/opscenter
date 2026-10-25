import fs from 'node:fs';
import {drainWaypointPush} from '../lib/waypoint-push-worker';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {getKernelPool} from '../lib/platform/persistence/pool';
import {waypointPushEnabled,WAYPOINT_PUSH_HOME,recordWaypointChanges,retainWaypointPush} from '../lib/waypoint-push';

async function main(){
 if(process.env.OPSCENTER_RUNTIME!=='MISSION_CONTROL' || process.env.OPSCENTER_PROCESS_ROLE!=='waypoint-push-dispatcher')throw Error('Invalid Waypoint sender role.');
 if(!waypointPushEnabled())return;
 const pool=getKernelPool(),leader=await pool.connect();
 if(!(await leader.query("SELECT pg_try_advisory_lock(hashtext('waypoint-push-sender')) AS locked")).rows[0].locked)throw Error('Waypoint sender already running.');
 const key=execFileSync('/usr/bin/security',['find-generic-password','-a','opscenter','-s','com.opscenter.web-push-vapid-private-key','-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 if(!/^[A-Za-z0-9_-]{43}$/.test(key))throw Error('Signing key unavailable.');process.env.OPSCENTER_WEB_PUSH_PRIVATE_KEY=key;
 let stopping=false,running=false,dirty=false,failed=false;let heartbeat:ReturnType<typeof setInterval>|undefined,deliveryTimer:ReturnType<typeof setTimeout>|undefined;const watchers:fs.FSWatcher[]=[];
 const environmentFile='/Users/missioncontrol/Library/Application Support/OpsCenter/production.env',environmentStamp=fs.statSync(environmentFile).mtimeMs;
 const enabled=()=>!stopping && waypointPushEnabled();
 async function wake(capture=true){if(capture)dirty=true;if(running || stopping)return;running=true;
  if(deliveryTimer)clearTimeout(deliveryTimer);
  try{
   do{if(dirty){dirty=false;await recordWaypointChanges(pool);}await drainWaypointPush(pool,enabled);}while(dirty&&enabled());
   // One local timer for durable queued work, not a source/provider poll. It also
   // recovers a not-yet-due group after a worker restart.
   if(enabled()){
    const due=(await pool.query("SELECT min(not_before) AS due FROM opscenter_kernel.waypoint_push_deliveries WHERE status='pending'")).rows[0]?.due;
    if(due)deliveryTimer=setTimeout(()=>void wake(false),Math.max(25,new Date(due).getTime()-Date.now()));
   }
  }catch{console.error('Waypoint notification processing unavailable.');stop(true);}
  finally{running=false;}
 }
 function ready(){const file=path.join(WAYPOINT_PUSH_HOME,'ready.json'),temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify({until:Date.now()+5000,pid:process.pid}),{mode:0o600});fs.renameSync(temp,file);}
 function stop(failure=false){failed ||= failure;if(stopping)return;stopping=true;try{fs.unlinkSync(path.join(WAYPOINT_PUSH_HOME,'ready.json'));}catch{}for(const watcher of watchers)watcher.close();if(heartbeat)clearInterval(heartbeat);if(deliveryTimer)clearTimeout(deliveryTimer);}
 const data=process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data');
 await pool.query("UPDATE opscenter_kernel.waypoint_push_deliveries SET status='uncertain' WHERE status='sending'");
 await leader.query('LISTEN waypoint_push');leader.on('notification',()=>void wake());leader.on('error',()=>stop(true));leader.on('end',()=>stop(true));
 // Source snapshots may coalesce. Alerts mean "open the latest truck updates",
 // never a promise of a complete transition history. No source/provider polling.
 const runtimeData=process.env.OPSCENTER_DATA_DIR || data;
 const directories=[path.join(data,'history/junkware'),process.env.OPS_CREW_PHONE_DIR || path.join(runtimeData,'crew-phones'),process.env.SCHEDULE_STOP_ORDER_DIR || path.join(process.cwd(),'data/schedule-stop-order'),path.dirname(process.env.JOB_ROUTE_ASSIGNMENTS_FILE || path.join(process.cwd(),'data/job-route-assignments/assignments.json')),process.env.OPS_CREW_DISPATCH_DIR || path.join(runtimeData,'crew-dispatch')];
 for(const dir of new Set(directories)){
  fs.mkdirSync(dir,{recursive:true});const watcher=fs.watch(dir,{recursive:true},()=>void wake());watcher.on('error',()=>stop(true));watchers.push(watcher);
 }


 heartbeat=setInterval(()=>{if(!enabled()){stop();return;}try{if(fs.realpathSync('/Users/missioncontrol/opscenter-v2/opscenter')!==process.cwd() || fs.statSync(environmentFile).mtimeMs!==environmentStamp){stop(true);return;}ready();}catch{stop(true);}},2000);
 process.on('SIGTERM',()=>stop());process.on('SIGINT',()=>stop());
 await wake();await retainWaypointPush(pool);if(!stopping)ready();
 while(!stopping)await new Promise(resolve=>setTimeout(resolve,500));
 while(running)await new Promise(resolve=>setTimeout(resolve,50));
 delete process.env.OPSCENTER_WEB_PUSH_PRIVATE_KEY;leader.release();await pool.end();if(failed)process.exitCode=1;
}
main().catch(()=>{console.error('Waypoint sender stopped; check configuration and database.');process.exit(1);});
