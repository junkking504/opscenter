import { createHash } from 'node:crypto';
import { startPushJournal } from '../lib/web-push-journal';
import { retainPushMetadata } from '../lib/web-push-retention';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Pool, Client } from 'pg';
import { recordPushBatch, drainPushOutbox, runPushWorker, type PushWorkerDependencies, PUSH_LOCK } from '../lib/web-push-worker';
import { startPushDispatcher } from '../lib/web-push-dispatcher';
import { managePushDevice, readPushHealth } from '../lib/web-push-store';
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
 const batch=(observations:PushBatch['observations'],complete=true):PushBatch=>({scope:`schedule:${new Date().toISOString().slice(0,10)}`,category:'schedule',sequence:++seq,complete,observedAt:new Date(stamp+=10).toISOString(),observations});
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
 await recordPushBatch(batch(one('retained-test')),d);await drainPushOutbox(d);assert.equal(sends,beforeCategory+1,'retained events have no unapproved age cutoff');
 await recordPushBatch(batch(one('uncertain-test')),d);sendHook=async()=>{throw new Error('synthetic unknown outcome');};await drainPushOutbox(d);sendHook=undefined;
 const afterUnknown=sends;await drainPushOutbox(d);assert.equal(sends,afterUnknown);
 assert.ok(Number((await p.query("SELECT count(*) FROM opscenter_kernel.push_deliveries WHERE status='uncertain'")).rows[0].count)>=2);
 const conflict={...reappeared,observations:one('conflicting-replay')};await assert.rejects(recordPushBatch(conflict,d),/sequence_conflict/);
 // Definitive invalid subscription prevents subsequent events; no automatic retry.
 code=410;await recordPushBatch(batch(one('f')),d);await drainPushOutbox(d);
 assert.ok((await p.query('SELECT revoked_at FROM opscenter_kernel.push_devices WHERE id=$1',[device])).rows[0].revoked_at);
 const health=await readPushHealth(p);assert.ok(health.some(row=>row.scope.startsWith('krewe:')&&row.code==='source_unknown'),'missing source remains unknown');
 // Real Python publication -> retained journal -> PostgreSQL -> mocked sender.
 code=201;
 await managePushDevice('owner',{action:'subscribe',subscription,categories:['schedule'],expiresAt:new Date(Date.now()+60000)},p);
 await p.query("UPDATE opscenter_kernel.push_devices SET created_at=now()-interval '1 minute'");
 const journalRoot=path.join(root,'journal');
 const day=new Date().toISOString().slice(0,10),observed=new Date(Date.now()-1000).toISOString();
 const publish=(states:string[])=>execFileSync('python3',['-c',`
import json,sys
from pathlib import Path
from opscenter_push_journal import publish_json
root,day,stamp,states=sys.argv[1:]
for state in json.loads(states):
 publish_json(Path(root).parent / ("junkware_schedule_fast_"+day+".json"), {"date":day,"scraped_at":stamp,"territory_verification":[{"territory_id":"352","verified":True}],"appointments":[{"appt_id":"fixture","market":"New Orleans","job_status":state}]},journal_root=root,enabled=True)
`,journalRoot,day,observed,JSON.stringify(states)],{env:{...env,PYTHONPATH:path.join(process.cwd(),'scripts')}});
 publish(['A','B','C','D','A']);
 const beforeJournal=sends;
 const leader=await startPushDispatcher(d,new Client(config));stop=leader.stop;
 let journal=await startPushJournal(journalRoot,d);
 await until(async()=>sends===beforeJournal+4);
 assert.equal(fs.readdirSync(path.join(journalRoot,'ready')).filter(n=>n.endsWith('.json')).length,0);
 const scope=`schedule:${day}:market-352`;
 assert.equal(Number((await p.query('SELECT sequence FROM opscenter_kernel.push_sources WHERE scope=$1',[scope])).rows[0].sequence),5);
 // Simulate commit succeeding but archive acknowledgement being lost.
 await journal.stop();
 const replay=fs.readdirSync(path.join(journalRoot,'archive')).sort().at(-1)!;
 fs.copyFileSync(path.join(journalRoot,'archive',replay),path.join(journalRoot,'ready',replay));
 journal=await startPushJournal(journalRoot,d);
 assert.equal(sends,beforeJournal+4,'restart replay does not resend');
 publish(['E','F','G']);
 await until(async()=>sends===beforeJournal+7);
 await journal.stop();await stop();stop=undefined;
 // Disabled start does not even create its supplied directory.
 const disabledPath=path.join(root,'disabled-journal');
 await startPushJournal(disabledPath,{...d,enabled:()=>false});assert.equal(fs.existsSync(disabledPath),false);
 // Bounded replay checkpoint rejects old sequences and closes expired scopes.
 await p.query("INSERT INTO opscenter_kernel.push_batches(scope,sequence,digest) SELECT $1,n,'synthetic' FROM generate_series(9,10001) n",[scope]);
 await p.query('UPDATE opscenter_kernel.push_sources SET sequence=10001 WHERE scope=$1',[scope]);
 const retention=await p.connect();try{await retainPushMetadata(retention);}finally{retention.release();}
 assert.equal(Number((await p.query('SELECT count(*) FROM opscenter_kernel.push_batches WHERE scope=$1',[scope])).rows[0].count),10000);
 await assert.rejects(recordPushBatch({scope,category:'schedule',sequence:1,complete:true,observedAt:observed,observations:[]},d),/sequence_archived|generation_mismatch/);
 const oldDay=new Date(Date.now()-8*86400000).toISOString().slice(0,10);
 await assert.rejects(recordPushBatch({scope:`fleet:${oldDay}`,category:'fleet',sequence:1,complete:true,observedAt:observed,observations:[]},d),/source_date_expired/);
 // Independent-review probes: a poisoned scope/file cannot stop a good scope.
 const poisonRoot=path.join(root,'poison');fs.mkdirSync(path.join(poisonRoot,'ready'),{recursive:true});
 const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
 const fleetScope=`fleet:${day}`,fleetBatch:PushBatch={scope:fleetScope,category:'fleet',sequence:1,complete:true,observedAt:observed,observations:[{identity:hash('fleet-id'),revision:hash('arrival')}]};
 const oldScope=`krewe:${oldDay}`;
 const writeEntry=(name:string,value:unknown)=>fs.writeFileSync(path.join(poisonRoot,'ready',name),JSON.stringify(value));
 writeEntry('0000000000000001.json',{version:1,batches:[{...fleetBatch,scope:oldScope,category:'krewe'},fleetBatch]});
 fs.writeFileSync(path.join(poisonRoot,'ready','0000000000000002.json'),'{invalid');
 writeEntry('0000000000000003.json',{version:1,batches:[{...fleetBatch,sequence:2,observations:[{identity:hash('fleet-id'),revision:hash('departure')}]}]});
 let poisoned=await startPushJournal(poisonRoot,d);assert.equal(poisoned.active,true);await poisoned.stop();
 assert.equal(fs.readdirSync(path.join(poisonRoot,'quarantine')).length,2);
 assert.equal(Number((await p.query('SELECT sequence FROM opscenter_kernel.push_sources WHERE scope=$1',[fleetScope])).rows[0].sequence),2);
 assert.equal((await p.query('SELECT code FROM opscenter_kernel.push_health WHERE scope=$1',[oldScope])).rows[0].code,'coverage_gap');
 poisoned=await startPushJournal(poisonRoot,d);assert.equal(poisoned.active,true);await poisoned.stop();
 assert.equal(fs.readdirSync(path.join(poisonRoot,'ready')).length,0,'restart does not repeat poisoned record');
 // A transient DB failure keeps the entry ready and stops; recovery succeeds.
 writeEntry('0000000000000004.json',{version:1,batches:[{...fleetBatch,sequence:3,observations:[]}]});
 const brokenPool={query:p.query.bind(p),connect:async()=>{throw new Error('synthetic database unavailable');}} as unknown as Pool;
 const transient=await startPushJournal(poisonRoot,{...d,pool:brokenPool});assert.equal(transient.active,false);await transient.stop();
 assert.ok(fs.existsSync(path.join(poisonRoot,'ready','0000000000000004.json')));
 poisoned=await startPushJournal(poisonRoot,d);assert.equal(poisoned.active,true);await poisoned.stop();
 assert.equal(fs.readdirSync(path.join(poisonRoot,'ready')).length,0);
 // Future-scope noise cannot hide known current-day health.
 const localDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 await p.query("INSERT INTO opscenter_kernel.push_health(scope,code) SELECT 'schedule:2099-01-'||lpad(n::text,2,'0'),'recorded' FROM generate_series(1,25) n ON CONFLICT DO NOTHING");
 await p.query("INSERT INTO opscenter_kernel.push_health(scope,code) VALUES($1,'source_failed') ON CONFLICT(scope) DO UPDATE SET code='source_failed'",[`krewe:${localDay}`]);
 assert.ok((await readPushHealth(p)).some(row=>row.scope===`krewe:${localDay}`&&row.code==='source_failed'));
 // V2 retained publication survives a long outage; unsupported fleet removals
 // retain identity, so disappearance/reappearance does not manufacture an event.
 const oldStamp=new Date(Date.now()-8*86400000).toISOString();
 const retained:PushBatch={scope:`fleet:${oldDay}`,category:'fleet',sequence:1,complete:true,observedAt:oldStamp,recordedAt:oldStamp,generation:'a'.repeat(32),baseline:false,observations:[{identity:'retained-native',revision:'arrival'}]};
 await p.query("UPDATE opscenter_kernel.push_devices SET created_at=now()-interval '10 days'");
 await managePushDevice('owner',{action:'subscribe',subscription,categories:['fleet'],expiresAt:new Date(Date.now()+60000)},p);
 const catchup={...d,activatedAt:new Date(Date.now()-10*86400000).toISOString()};
 await recordPushBatch(retained,catchup);const beforeCatchup=sends;await drainPushOutbox(catchup);assert.equal(sends,beforeCatchup+1,'eight-day retained publication delivered with mocked sender');
 const eventCount=Number((await p.query('SELECT count(*) FROM opscenter_kernel.push_events')).rows[0].count);
 await recordPushBatch({...retained,sequence:2,observations:[]},catchup);
 await recordPushBatch({...retained,sequence:3},catchup);
 assert.equal(Number((await p.query('SELECT count(*) FROM opscenter_kernel.push_events')).rows[0].count),eventCount,'fleet missing/reappearance is not a supported event');
 // Explicit gap reset is silent and durable; subsequent transition delivers once.
 const reset={...retained,sequence:1,generation:'b'.repeat(32),reset:true,baseline:true,gapId:'c'.repeat(64),recordedAt:new Date(Date.parse(oldStamp)+1000).toISOString(),observations:[{identity:'retained-native',revision:'unknown-gap-end'}]};
 await recordPushBatch(reset,catchup);await drainPushOutbox(catchup);assert.equal(sends,beforeCatchup+1);
 await recordPushBatch({...reset,sequence:2,reset:false,baseline:false,observations:[{identity:'retained-native',revision:'departure'}]},catchup);
 await drainPushOutbox(catchup);assert.equal(sends,beforeCatchup+2);
 await assert.rejects(recordPushBatch({...retained,reset:true,baseline:true,gapId:'d'.repeat(64)},catchup),/reset_reordered/);
 console.log('PASS: independent malformed/expired-scope probes, same-file isolation, restart quarantine, eight-day retained catch-up, fleet removal restraint and explicit generation reset.');
 console.log('PASS: Python publication hooks -> retained burst journal -> DB NOTIFY -> mocked sender, restart replay, live filesystem wake, disabled no-I/O, replay checkpoint and closed-scope retention.');
 console.log('PASS: real PostgreSQL isolated cluster: baseline, versions/reversion, removal completeness, dedup, zero-claim race, scope failure, in-flight revoke, commit NOTIFY, burst fanout, single leader, restart catch-up, uncertain recovery and 410 expiry. All sender calls mocked.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await stop?.();await pool?.end();if(started)pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);fs.rmSync(root,{recursive:true,force:true});});
