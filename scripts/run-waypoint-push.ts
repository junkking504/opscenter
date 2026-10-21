import fs from 'node:fs';
import {drainWaypointPush} from '../lib/waypoint-push-worker';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {getKernelPool} from '../lib/platform/persistence/pool';
import {waypointPushEnabled,WAYPOINT_PUSH_HOME,recordWaypointChanges} from '../lib/waypoint-push';

async function main(){
 if(process.env.OPSCENTER_RUNTIME!=='MISSION_CONTROL' || process.env.OPSCENTER_PROCESS_ROLE!=='waypoint-push-dispatcher' || !waypointPushEnabled())throw Error('Waypoint sender disabled.');
 const pool=getKernelPool(),leader=await pool.connect();
 if(!(await leader.query("SELECT pg_try_advisory_lock(hashtext('waypoint-push-sender')) AS locked")).rows[0].locked)throw Error('Waypoint sender already running.');
 const key=execFileSync('/usr/bin/security',['find-generic-password','-a','opscenter','-s','com.opscenter.web-push-vapid-private-key','-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 if(!/^[A-Za-z0-9_-]{43}$/.test(key))throw Error('Signing key unavailable.');process.env.OPSCENTER_WEB_PUSH_PRIVATE_KEY=key;
 let stopping=false,running=false,dirty=false;let heartbeat:ReturnType<typeof setInterval>|undefined;const watchers:fs.FSWatcher[]=[];
 const enabled=()=>!stopping && waypointPushEnabled();
 async function wake(){dirty=true;if(running || stopping)return;running=true;
  try{while(dirty && enabled()){dirty=false;await recordWaypointChanges(pool);await drainWaypointPush(pool,enabled);}}
  catch{console.error('Waypoint notification processing unavailable.');stop();}
  finally{running=false;}
 }
 function ready(){const file=path.join(WAYPOINT_PUSH_HOME,'ready.json'),temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify({until:Date.now()+5000,pid:process.pid}),{mode:0o600});fs.renameSync(temp,file);}
 function stop(){if(stopping)return;stopping=true;try{fs.unlinkSync(path.join(WAYPOINT_PUSH_HOME,'ready.json'));}catch{}for(const watcher of watchers)watcher.close();if(heartbeat)clearInterval(heartbeat);}
 const data=process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data');
 await leader.query('LISTEN waypoint_push');leader.on('notification',()=>void wake());leader.on('error',stop);leader.on('end',stop);
 // Source snapshots may coalesce. Alerts mean "open the latest truck updates",
 // never a promise of a complete transition history. No source/provider polling.
 for(const relative of ['history/junkware','crew-phones','schedule-stop-order','job-route-assignments','crew-dispatch']){
  const dir=path.join(data,relative);fs.mkdirSync(dir,{recursive:true});const watcher=fs.watch(dir,{recursive:true},()=>void wake());watcher.on('error',stop);watchers.push(watcher);
 }
 await pool.query("UPDATE opscenter_kernel.waypoint_push_deliveries SET status='uncertain' WHERE status='sending'");
 await pool.query("DELETE FROM opscenter_kernel.waypoint_messages WHERE service_date<current_date-14");
 await pool.query("DELETE FROM opscenter_kernel.waypoint_push_deliveries WHERE created_at<now()-interval '14 days' AND status NOT IN ('pending','sending')");
 heartbeat=setInterval(()=>{if(!enabled()){stop();return;}try{ready();}catch{stop();}},2000);
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
 await wake();if(!stopping)ready();
 while(!stopping)await new Promise(resolve=>setTimeout(resolve,500));
 while(running)await new Promise(resolve=>setTimeout(resolve,50));
 delete process.env.OPSCENTER_WEB_PUSH_PRIVATE_KEY;leader.release();await pool.end();
}
main().catch(()=>{console.error('Waypoint sender stopped; check configuration and database.');process.exitCode=1;});
