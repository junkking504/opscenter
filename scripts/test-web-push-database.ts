import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Pool, Client } from 'pg';
import { recordPushBatch, drainPushOutbox, runPushWorker, type PushWorkerDependencies, PUSH_LOCK } from '../lib/web-push-worker';
import { startPushDispatcher } from '../lib/web-push-dispatcher';
import { managePushDevice } from '../lib/web-push-store';
import type { PushBatch } from '../lib/web-push-events';

// Installed local PostgreSQL only. Private Unix socket; TCP listening disabled.
// No environment database URL, production config, Keychain or network sender.
const bin='/opt/homebrew/opt/postgresql@18/bin';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ops-push-test-'));
const socket=path.join(root,'socket'),data=path.join(root,'db');fs.mkdirSync(socket);
let started=false,pool:Pool|undefined,stop:(()=>Promise<void>)|undefined;
const env:NodeJS.ProcessEnv={NODE_ENV:'test',PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C',LC_ALL:'C'};
function pg(command:string,args:string[]){return execFileSync(path.join(bin,command),args,{env,stdio:'pipe'});}
async function until(check:()=>Promise<boolean>){const end=Date.now()+4000;while(!(await check())){assert.ok(Date.now()<end,'timed out');await new Promise(r=>setTimeout(r,10));}}
async function main(){
 pg('initdb',['-D',data,'--no-locale','-A','trust','-U','push_test']);
 pg('pg_ctl',['-D',data,'-l',path.join(root,'server.log'),'-o',`-h '' -k ${socket} -p 5432`,'-w','start']);started=true;
 pg('createdb',['-h',socket,'-U','push_test','opscenter_push_preview_test']);
 const config={host:socket,user:'push_test',database:'opscenter_push_preview_test'};
 pool=new Pool(config);const p=pool;
 await p.query('CREATE SCHEMA opscenter_kernel');
 for(const name of fs.readdirSync('lib/platform/persistence/migrations').filter(n=>/^[0-9]+.*sql$/.test(n)).sort())await p.query(fs.readFileSync(path.join('lib/platform/persistence/migrations',name),'utf8'));
 let sends=0;let code=201;let sendHook:(()=>Promise<void>)|undefined;
 const d:PushWorkerDependencies={pool:p,enabled:()=>true,send:async()=>{sends++;await sendHook?.();return code;},ownerAllowed:o=>o==='owner',activatedAt:new Date(Date.now()-60000).toISOString()};
 const subscription={endpoint:'https://web.push.apple.com/Q'+'x'.repeat(64),keys:{p256dh:'synthetic',auth:'synthetic'}};
 const device=await managePushDevice('owner',{action:'subscribe',subscription,categories:['schedule','fleet'],expiresAt:new Date(Date.now()+60000)},p);
 await p.query("UPDATE opscenter_kernel.push_devices SET created_at=now()-interval '1 minute'");
 let seq=0,stamp=Date.now()-20000;
 const batch=(observations:PushBatch['observations'],complete=true):PushBatch=>({scope:'schedule:2026-10-18',category:'schedule',sequence:++seq,complete,observedAt:new Date(stamp+=10).toISOString(),observations});
 const one=(revision:string)=>[{identity:'A',revision}];
 await recordPushBatch(batch(one('a')),d);assert.equal((await drainPushOutbox(d)).attempted,0);
 await recordPushBatch(batch(one('a')),d);assert.equal((await drainPushOutbox(d)).attempted,0);
 await recordPushBatch(batch(one('b')),d);await drainPushOutbox(d);assert.equal(sends,1);
 await recordPushBatch(batch(one('a')),d);await drainPushOutbox(d);assert.equal(sends,2,'reversion');
 await recordPushBatch(batch([],false),d);await drainPushOutbox(d);assert.equal(sends,2,'partial missing is unknown');
 await recordPushBatch(batch([]),d);await drainPushOutbox(d);assert.equal(sends,3,'complete empty produces tombstone');
 const reappeared=batch(one('a'));await recordPushBatch(reappeared,d);await recordPushBatch(reappeared,d);await drainPushOutbox(d);assert.equal(sends,4,'reappearance once');
 // Reproduce stale selection: hold device lock until category-save commits.
 await recordPushBatch(batch(one('b')),d);
 const blocker=await p.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM opscenter_kernel.push_devices WHERE id=$1 FOR UPDATE',[device]);
 const draining=drainPushOutbox(d);
 await until(async()=>Number((await p.query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT * FROM opscenter_kernel.push_devices%'")).rows[0].count)>0);
 await blocker.query("UPDATE opscenter_kernel.push_deliveries SET status='skipped',reason='category_save' WHERE device_id=$1 AND status='pending'",[device]);await blocker.query('COMMIT');blocker.release();await draining;assert.equal(sends,4,'zero claim never sends');
 // Separate scopes fail independently; missing sequence is not silently accepted.
 const bad={...batch(one('c')),sequence:seq+2};seq--;
 await runPushWorker([bad],d);assert.equal((await p.query("SELECT code FROM opscenter_kernel.push_health WHERE scope=$1",[bad.scope])).rows[0].code,'sequence_gap');
 // Revoke completes during the network request: no row lock remains held.
 await recordPushBatch(batch(one('c')),d);
 let releaseSend:()=>void=()=>{};let entered:()=>void=()=>{};const inside=new Promise<void>(r=>{entered=r;});
 sendHook=async()=>{entered();await new Promise<void>(r=>{releaseSend=r;});};
 const inFlight=drainPushOutbox(d);await inside;
 await managePushDevice('owner',{action:'unsubscribe',deviceId:device,expiresAt:new Date()},p);
 releaseSend();await inFlight;sendHook=undefined;assert.equal(sends,5);
 await recordPushBatch(batch(one('d')),d);await drainPushOutbox(d);assert.equal(sends,5,'revoke prevents later claims');
 // Re-enrollment does not resurrect previously skipped deliveries.
 await managePushDevice('owner',{action:'subscribe',subscription,categories:['schedule','fleet'],expiresAt:new Date(Date.now()+60000)},p);
 await p.query("UPDATE opscenter_kernel.push_devices SET created_at=now()-interval '1 minute'");
 // No timer drives delivery: real NOTIFY wakes the listener after commit.
 const listener=new Client(config);const runtime=await startPushDispatcher(d,listener);stop=runtime.stop;
 const second=await startPushDispatcher(d,new Client(config));assert.ok('busy' in second);
 const before=sends;const producer=await p.connect();await producer.query('BEGIN');
 await producer.query("INSERT INTO opscenter_kernel.push_events(id,category,occurred_at) VALUES('commit-test','schedule',now())");
 await producer.query("INSERT INTO opscenter_kernel.push_deliveries(event_id,device_id) VALUES('commit-test',$1)",[device]);
 await producer.query("SELECT pg_notify('opscenter_web_push','')");
 await new Promise(r=>setTimeout(r,50));assert.equal(sends,before,'uncommitted intent not visible');
 await producer.query('COMMIT');producer.release();await until(async()=>sends===before+1);
 // N events are N claims, no per-device coalescing.
 await recordPushBatch(batch([...one('e'),...Array.from({length:5},(_,n)=>({identity:`burst-${n}`,revision:'new'}))]),d);
 await until(async()=>sends===before+7);
 await stop();stop=undefined;
 // Durable catch-up and uncertainty recovery under exclusive leadership.
 await p.query("INSERT INTO opscenter_kernel.push_events(id,category,occurred_at) VALUES('missed','schedule',now()),('interrupted','schedule',now())");
 await p.query("INSERT INTO opscenter_kernel.push_deliveries(event_id,device_id,status) VALUES('missed',$1,'pending'),('interrupted',$1,'sending')",[device]);
 const beforeRestart=sends;const restarted=await startPushDispatcher(d,new Client(config));stop=restarted.stop;
 await until(async()=>sends===beforeRestart+1);
 assert.equal((await p.query("SELECT status FROM opscenter_kernel.push_deliveries WHERE event_id='interrupted'")).rows[0].status,'uncertain');
 const terminatedPid=(await p.query("SELECT pid FROM pg_stat_activity WHERE application_name='opscenter-push-listener'")).rows[0]?.pid;
 // Supplied test Client has no application_name, identify its held advisory lock.
 const leaderPid=terminatedPid||(await p.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=$1",[PUSH_LOCK])).rows[0].pid;
 await p.query('SELECT pg_terminate_backend($1)',[leaderPid]);
 await until(async()=>!('active' in restarted)||!restarted.active);
 await stop();stop=undefined;
 const lockProbe=new Client(config);await lockProbe.connect();assert.equal((await lockProbe.query('SELECT pg_try_advisory_lock($1) AS locked',[PUSH_LOCK])).rows[0].locked,true);await lockProbe.end();
 // Reauthorize category/owner at claim and preserve definitive uncertainty.
 await recordPushBatch(batch(one('category-test')),d);
 await managePushDevice('owner',{action:'subscribe',subscription,categories:['fleet'],expiresAt:new Date(Date.now()+60000)},p);
 const beforeCategory=sends;await drainPushOutbox(d);assert.equal(sends,beforeCategory);
 await managePushDevice('owner',{action:'subscribe',subscription,categories:['schedule'],expiresAt:new Date(Date.now()+60000)},p);
 await recordPushBatch(batch(one('owner-test')),d);await drainPushOutbox({...d,ownerAllowed:()=>false});assert.equal(sends,beforeCategory);
 await recordPushBatch(batch(one('stale-test')),d);await drainPushOutbox({...d,maxAgeMs:1});assert.equal(sends,beforeCategory);
 await recordPushBatch(batch(one('uncertain-test')),d);sendHook=async()=>{throw new Error('synthetic unknown outcome');};await drainPushOutbox(d);sendHook=undefined;
 const afterUnknown=sends;await drainPushOutbox(d);assert.equal(sends,afterUnknown);
 assert.ok(Number((await p.query("SELECT count(*) FROM opscenter_kernel.push_deliveries WHERE status='uncertain'")).rows[0].count)>=2);
 const conflict={...reappeared,observations:one('conflicting-replay')};await assert.rejects(recordPushBatch(conflict,d),/sequence_conflict/);
 // Definitive invalid subscription prevents subsequent events; no automatic retry.
 code=410;await recordPushBatch(batch(one('f')),d);await drainPushOutbox(d);
 assert.ok((await p.query('SELECT revoked_at FROM opscenter_kernel.push_devices WHERE id=$1',[device])).rows[0].revoked_at);
 console.log('PASS: real PostgreSQL isolated cluster: baseline, versions/reversion, removal completeness, dedup, zero-claim race, scope failure, in-flight revoke, commit NOTIFY, burst fanout, single leader, restart catch-up, uncertain recovery and 410 expiry. All sender calls mocked.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await stop?.();await pool?.end();if(started)pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);fs.rmSync(root,{recursive:true,force:true});});
