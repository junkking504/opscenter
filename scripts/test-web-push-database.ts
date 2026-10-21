import { controlPushTrial, trialFingerprint } from '../lib/web-push-trial';
import { archivePushScopes,pushRetirementCutoff,createPushMaintenance } from '../lib/web-push-archive';
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
import { managePushDevice as rawManagePushDevice, readPushHealth } from '../lib/web-push-store';
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
 // Core pipeline fixtures below span many independent scenarios. Each mocked
 // transport ends its isolated budget fixture; the dedicated trial database suite
 // exercises the real lifetime cap without resets. No production bypass exists.
 await controlPushTrial({action:'prepare',owner:'owner'},'local core fixture',p);
 const managePushDevice:typeof rawManagePushDevice=async(owner,input,pool)=>{
   const id=await rawManagePushDevice(owner,input,pool);
   if(input.action==='subscribe'){
     await controlPushTrial({action:'approve',owner,deviceId:id,fingerprint:trialFingerprint(input.subscription!),expiresInMinutes:30},'local core device fixture',p);
     const t=(await p.query('SELECT started_at FROM opscenter_kernel.push_trial')).rows[0];
     if(!t.started_at)await controlPushTrial({action:'start'},'local core start fixture',p);
     await p.query("UPDATE opscenter_kernel.push_trial SET started_at=statement_timestamp()-interval '20 minutes',deadline=statement_timestamp()+interval '10 minutes'");
   }
   return id;
 };
 let sends=0;let code=201;let sendHook:(()=>Promise<void>)|undefined;
 const d:PushWorkerDependencies={pool:p,enabled:()=>true,send:async()=>{sends++;await p.query('DELETE FROM opscenter_kernel.push_trial_attempts');await p.query('UPDATE opscenter_kernel.push_trial SET attempts_used=0');await sendHook?.();return code;},ownerAllowed:o=>o==='owner',activatedAt:new Date(Date.now()-60000).toISOString()};
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
 let retirementWakes=0;const listener=new Client(config);const runtime=await startPushDispatcher(d,listener,undefined,()=>{retirementWakes++;});stop=runtime.stop;
 const second=await startPushDispatcher(d,new Client(config));assert.ok('busy' in second);
 await managePushDevice('owner',{action:'subscribe',subscription,categories:['schedule','fleet'],expiresAt:new Date(Date.now()+60000)},p);
 await until(async()=>retirementWakes>0);
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
 // Real producer gap: preserve observations and notify the next proven change.
 let gapWrites=0;
 const countedPool={connect:p.connect.bind(p),query:async(sql:string,args?:unknown[])=>{if(sql.includes('INSERT INTO opscenter_kernel.push_gaps'))gapWrites++;return p.query(sql,args);}} as unknown as Pool;
 const recoverPending=async()=>{execFileSync('python3',['scripts/opscenter_push_journal.py','--recover',journalRoot],{env});};
 const scopeForRecovery=`schedule:${day}:market-352`;
 execFileSync('python3',['-c',`from pathlib import Path
from opscenter_push_journal import mark_gap
mark_gap(Path(__import__('sys').argv[1]), [__import__('sys').argv[2]], 'capture_failure')`,journalRoot,scopeForRecovery],{env:{...env,PYTHONPATH:path.join(process.cwd(),'scripts')}});
 publish(['H']);
 let recoveryJournal=await startPushJournal(journalRoot,{...d,pool:countedPool},undefined,recoverPending);
 const beforeRecoveredSend=sends;await drainPushOutbox(d);assert.equal(sends,beforeRecoveredSend+1,'first proven transition after gap is retained');
 const gapRow=(await p.query('SELECT resolved_at,recovered_generation FROM opscenter_kernel.push_gaps WHERE scope=$1',[scopeForRecovery])).rows[0];
 assert.ok(gapRow.resolved_at&&gapRow.recovered_generation);
 assert.ok((await readPushHealth(p)).some(row=>row.scope===scopeForRecovery&&row.code==='recovered_gap'));
 const firstGapWrites=gapWrites;
 recoveryJournal.wake!();await new Promise(resolve=>setTimeout(resolve,30));
 recoveryJournal.wake!();await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(gapWrites,firstGapWrites,'unchanged gaps do not generate DB writes every wake');
 await recoveryJournal.stop();
 recoveryJournal=await startPushJournal(journalRoot,{...d,pool:countedPool},undefined,recoverPending);await recoveryJournal.stop();
 assert.equal((await p.query('SELECT code FROM opscenter_kernel.push_health WHERE scope=$1',[scopeForRecovery])).rows[0].code,'recovered_gap','restart cannot reopen resolved gap');
 // Two publications while lock is held survive in spool and dispatch on restart.
 execFileSync('python3',['-c',`import fcntl,sys
from pathlib import Path
from opscenter_push_journal import publish_json
root,day,stamp=sys.argv[1:]
with (Path(root)/'writer.lock').open('a') as holder:
 fcntl.flock(holder,fcntl.LOCK_EX)
 for state in ['I','J']:
  publish_json(Path(root).parent / ('junkware_schedule_fast_'+day+'.json'), {'date':day,'scraped_at':stamp,'territory_verification':[{'territory_id':'352','verified':True}],'appointments':[{'appt_id':'fixture','market':'New Orleans','job_status':state}]},journal_root=root,enabled=True)
`,journalRoot,day,observed],{env:{...env,PYTHONPATH:path.join(process.cwd(),'scripts')}});
 const beforeSpool=sends;
 recoveryJournal=await startPushJournal(journalRoot,d,undefined,recoverPending);await recoveryJournal.stop();
 await drainPushOutbox(d);assert.equal(sends,beforeSpool+2,'both contended captures dispatch exactly once');
 assert.equal(fs.readdirSync(path.join(journalRoot,'pending')).filter(name=>name.endsWith('.json')).length,0);
 console.log('PASS: gap reconciliation retains next transition; resolved health survives restart; unchanged gaps cause no repeat DB writes; contention spool dispatches both transitions.');

 // Disabled start does not even create its supplied directory.
 const disabledPath=path.join(root,'disabled-journal');
 await startPushJournal(disabledPath,{...d,enabled:()=>false});assert.equal(fs.existsSync(disabledPath),false);
 // Bounded replay checkpoint rejects old sequences and closes expired scopes.
 await p.query("INSERT INTO opscenter_kernel.push_batches(scope,sequence,digest) SELECT $1,n,'synthetic' FROM generate_series(4,10001) n",[scope]);
 await p.query('UPDATE opscenter_kernel.push_sources SET sequence=10001 WHERE scope=$1',[scope]);
 const retention=await p.connect();try{await retainPushMetadata(retention);}finally{retention.release();}
 assert.equal(Number((await p.query('SELECT count(*) FROM opscenter_kernel.push_batches WHERE scope=$1',[scope])).rows[0].count),10000);
 await assert.rejects(recordPushBatch({scope,category:'schedule',sequence:1,complete:true,observedAt:observed,observations:[]},d),/sequence_archived|generation_mismatch/);
 const oldDay=new Date(Date.now()-16*86400000).toISOString().slice(0,10);
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
 const retainedDay=oldStamp.slice(0,10);
 const retained:PushBatch={scope:`fleet:${retainedDay}`,category:'fleet',sequence:1,complete:true,observedAt:oldStamp,recordedAt:oldStamp,generation:'a'.repeat(32),baseline:false,observations:[{identity:'retained-native',revision:'arrival'}]};
 await p.query("UPDATE opscenter_kernel.push_devices SET created_at=now()-interval '10 days'");
 await managePushDevice('owner',{action:'subscribe',subscription,categories:['fleet'],expiresAt:new Date(Date.now()+60000)},p);
 const catchup={...d,activatedAt:new Date(Date.now()-10*86400000).toISOString()};
 await recordPushBatch(retained,catchup);const beforeCatchup=sends;await drainPushOutbox(catchup);assert.equal(sends,beforeCatchup,'pretrial retained publication recorded but never delivered');
 const eventCount=Number((await p.query('SELECT count(*) FROM opscenter_kernel.push_events')).rows[0].count);
 await recordPushBatch({...retained,sequence:2,observations:[]},catchup);
 await recordPushBatch({...retained,sequence:3},catchup);
 assert.equal(Number((await p.query('SELECT count(*) FROM opscenter_kernel.push_events')).rows[0].count),eventCount,'fleet missing/reappearance is not a supported event');
 // Explicit gap reset is silent and durable; subsequent transition delivers once.
 const reset={...retained,sequence:1,generation:'b'.repeat(32),reset:true,baseline:true,gapId:'c'.repeat(64),recordedAt:new Date(Date.parse(oldStamp)+1000).toISOString(),observations:[{identity:'retained-native',revision:'unknown-gap-end'}]};
 await recordPushBatch(reset,catchup);await drainPushOutbox(catchup);assert.equal(sends,beforeCatchup);
 await recordPushBatch({...reset,sequence:2,reset:false,baseline:false,observations:[{identity:'retained-native',revision:'departure'}]},catchup);
 await drainPushOutbox(catchup);assert.equal(sends,beforeCatchup);
 await assert.rejects(recordPushBatch({...retained,reset:true,baseline:true,gapId:'d'.repeat(64)},catchup),/reset_reordered/);
 // Approved fourteen-day scope retirement: DB and actual Python helper must
 // agree. Tests use synthetic rows/private journal only, never production data.
 const retirementRoot=path.join(root,'retirement');fs.mkdirSync(retirementRoot);
 const cutoff=pushRetirementCutoff();
 assert.equal(pushRetirementCutoff(new Date('2026-10-18T02:00:00Z')),'2026-10-03','Chicago cutoff before UTC midnight differs');
 const archivedScope=`schedule:${oldDay}:market-399`,pendingScope=`schedule:${oldDay}:market-484`,boundaryScope=`schedule:${cutoff}:market-399`;
 const retainedScope=`schedule:${oldDay}:market-477`,orphanScope=`schedule:${oldDay}:market-352`;
 const retirementState={ordinal:0,scopes:Object.fromEntries([archivedScope,pendingScope,boundaryScope,retainedScope].map(scope=>[scope,{generation:'f'.repeat(32),sequence:3}]))};
 fs.writeFileSync(path.join(retirementRoot,'state.json'),JSON.stringify(retirementState));
 for(const scope of [archivedScope,pendingScope,boundaryScope,retainedScope])await p.query(`INSERT INTO opscenter_kernel.push_sources(scope,sequence,observed_at,baseline_complete,generation) VALUES($1,3,now(),true,$2)`,[scope,'f'.repeat(32)]);
 await p.query(`INSERT INTO opscenter_kernel.push_gaps(scope,gap_id,code,observed_at) VALUES($1,$2,'capture_failure',now())`,[orphanScope,'f'.repeat(32)]);
 await p.query(`INSERT INTO opscenter_kernel.push_events(id,category,occurred_at,source_scope) VALUES('retention-pending','schedule',now(),$1)`,[pendingScope]);
 await p.query(`INSERT INTO opscenter_kernel.push_deliveries(event_id,device_id) VALUES('retention-pending',$1)`,[device]);
 fs.mkdirSync(path.join(retirementRoot,'quarantine'));
 const protectedFile=path.join(retirementRoot,'quarantine','retained.json');fs.writeFileSync(protectedFile,JSON.stringify({batches:[{scope:retainedScope}]}));
 const retireFiles=async(cutoff:string,acks:import('../lib/web-push-archive').PushAcknowledgement[])=>JSON.parse(execFileSync('python3',['scripts/opscenter_push_journal.py','--retire',retirementRoot,'--cutoff',cutoff,'--acknowledgements',JSON.stringify(acks)],{env:{...env,PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8'})) as string[];
 const retired=await archivePushScopes(d,retireFiles);
 assert.ok(retired.includes(archivedScope)&&retired.includes(orphanScope));
 assert.ok(!retired.includes(pendingScope)&&!retired.includes(boundaryScope)&&retired.includes(retainedScope));
 assert.equal((await p.query('SELECT * FROM opscenter_kernel.push_sources WHERE scope=$1',[archivedScope])).rows.length,0);
 assert.ok(!fs.existsSync(protectedFile),'provably old withheld evidence expires with counted receipt');
 assert.equal(JSON.parse(fs.readFileSync(path.join(retirementRoot,'retention-audit.json'),'utf8')).expired.quarantine,1);
 await assert.rejects(recordPushBatch({scope:archivedScope,category:'schedule',sequence:1,complete:true,observedAt:new Date(Date.now()-16*86400000).toISOString(),recordedAt:new Date(Date.now()-16*86400000).toISOString(),generation:'f'.repeat(32),baseline:false,observations:[]},d),/scope_retired/);
 // Age pruning never consumes pending deliveries; terminal history expires.
 await p.query("UPDATE opscenter_kernel.push_events SET recorded_at=now()-interval '15 days' WHERE id='retention-pending'");
 await p.query("INSERT INTO opscenter_kernel.push_events(id,category,occurred_at,recorded_at) VALUES('retention-terminal','schedule',now()-interval '15 days',now()-interval '15 days'),('retention-recent','schedule',now()-interval '13 days',now()-interval '13 days')");
 const maintenance=await p.connect();try{await retainPushMetadata(maintenance);}finally{maintenance.release();}
 assert.equal((await p.query("SELECT id FROM opscenter_kernel.push_events WHERE id='retention-pending'")).rows.length,1);
 assert.equal((await p.query("SELECT id FROM opscenter_kernel.push_events WHERE id='retention-terminal'")).rows.length,0);
 assert.equal((await p.query("SELECT id FROM opscenter_kernel.push_events WHERE id='retention-recent'")).rows.length,1);
 await archivePushScopes({...d,enabled:()=>false},async()=>{throw new Error('disabled archive must perform no I/O');});
 // Acknowledged file phase followed by DB rollback retains its compact floor;
 // retry reconciles the absent file checkpoint without reviving old events.
 await p.query("UPDATE opscenter_kernel.push_deliveries SET status='sending' WHERE event_id='retention-pending'");
 assert.ok(!(await archivePushScopes(d,retireFiles)).includes(pendingScope),'in-flight delivery prevents retirement');
 await p.query("UPDATE opscenter_kernel.push_deliveries SET status='uncertain' WHERE event_id='retention-pending'");
 const beforeUncertain=sends;await drainPushOutbox(d);assert.equal(sends,beforeUncertain,'uncertain delivery is never replayed');
 await assert.rejects(archivePushScopes(d,async(c,acks)=>{await retireFiles(c,acks);throw new Error('synthetic_after_file_commit');}),/synthetic_after_file_commit/);
 assert.equal((await p.query('SELECT * FROM opscenter_kernel.push_sources WHERE scope=$1',[pendingScope])).rows.length,1);
 assert.ok((await archivePushScopes(d,retireFiles)).includes(pendingScope));
 assert.ok(!(await archivePushScopes(d,retireFiles)).includes(pendingScope),'restart does not recreate retired scope');
 // Actual producer publication with a controlled historical clock. Full detail
 // intervals overlap page-stream intervals but are ordered against prior details.
 const assignmentRoot=path.join(root,'assignment');
 const assignmentDay=new Date(Date.now()+86400000).toISOString().slice(0,10);
 execFileSync('python3',['-c',`
import sys,json
from pathlib import Path
from datetime import datetime,timedelta,timezone
sys.path.insert(0,'scripts')
import opscenter_push_journal as J
base=datetime.now(timezone.utc)
t=lambda seconds:(base-timedelta(seconds=seconds)).isoformat()
class Clock(datetime):
 point=base
 @classmethod
 def now(cls,tz=None):return cls.point.astimezone(tz) if tz else cls.point
J.datetime=Clock
root,day=sys.argv[1:]
def publish(end,start,driver=None,status='Scheduled'):
 Clock.point=base-timedelta(seconds=end)
 row={'appt_id':'assignment-fixture','market':'Jefferson Parish','job_status':status}
 if driver:row.update(driver=driver,navigator='Navigator',crew_assignment_status='verified')
 target=Path(root).parent/('junkware_'+day+'_raw.json' if driver else 'junkware_schedule_fast_'+day+'.json')
 J.publish_json(target,{'date':day,'scraped_at':t(end+1),'territory_verification':[{'territory_id':'484','verified':True}],'appointments':[row]},journal_root=root,enabled=True,observation_started_at=t(start))
publish(900,901)
publish(890,950,'Driver A')
for n in range(6):
 publish(800-n*50,801-n*50)
 publish(790-n*50,850-n*50,'Driver A')
publish(400,460,'Driver B')
publish(390,391)
publish(380,600,'Driver C')
publish(370,371,status='Arrived')
`,assignmentRoot,assignmentDay],{env:{...env,PYTHONDONTWRITEBYTECODE:'1'}});
 await managePushDevice('owner',{action:'subscribe',subscription,categories:['schedule'],expiresAt:new Date(Date.now()+60000)},p);
 await p.query("UPDATE opscenter_kernel.push_devices SET created_at=now()-interval '20 minutes'");
 const assignmentDeps={...d,activatedAt:new Date(Date.now()-20*60000).toISOString()};const beforeAssignment=sends;
 let assignmentJournal=await startPushJournal(assignmentRoot,assignmentDeps);await assignmentJournal.stop();await drainPushOutbox(assignmentDeps);
 assert.equal(sends,beforeAssignment+2,'silent roster/detail seed; one real crew reassignment and one page transition');
 assert.equal(fs.readdirSync(path.join(assignmentRoot,'uncertain')).length,1,'only distinct overlapping crew conflict retained');
 for(const file of fs.readdirSync(path.join(assignmentRoot,'archive')))fs.copyFileSync(path.join(assignmentRoot,'archive',file),path.join(assignmentRoot,'ready',file));
 assignmentJournal=await startPushJournal(assignmentRoot,assignmentDeps);await assignmentJournal.stop();await drainPushOutbox(assignmentDeps);assert.equal(sends,beforeAssignment+2,'restart replay sends nothing twice');
 console.log('PASS: actual publication -> DB -> mocked sender: silent first crew evidence, real reassignment, unchanged refresh dedup, preserved page transition and replay.');
 let scans=0,maintenanceNow=new Date();const gate=createPushMaintenance(async()=>{scans++;},()=>maintenanceNow);
 await gate.maintain();for(let n=0;n<100;n++)await gate.maintain();assert.equal(scans,1,'current-source wakes do not repeat retirement scans');
 gate.invalidate();await gate.maintain();assert.equal(scans,2,'changed eligibility invalidates scan');
 maintenanceNow=new Date(maintenanceNow.getTime()+86400000);await gate.maintain();assert.equal(scans,3,'cutoff rollover scans on next event');
 await gate.maintain(true);assert.equal(scans,4,'consumed old backlog triggers scan');
 // Presentation correlation uses only committed source observations. All new
 // cases prohibit delivery creation; the existing sender above is also mocked.
 {
 const formatDeps={...d,ownerAllowed:()=>false};
 const sequence=new Map<string,number>();let formatTime=Date.now()-60000;
 const formatDay=(offset:number)=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
 const oldDate=formatDay(30),newDate=formatDay(31);
 const oldScope=`schedule:${oldDate}:market-352`,newScope=`schedule:${newDate}:market-352`;
 const info=(date:string,time='12:00 PM - 01:00 PM',status='Confirmed')=>({date,time,status,label:'JK123 — Synthetic Customer',truck:'Truck #4',type:'Estimate'});
 const item=(identity:string,date:string,time='12:00 PM - 01:00 PM',status='Confirmed')=>({identity,revision:`${date}|${time}|${status}`,notification:{title:'Schedule updated',body:`Date: ${date}\nTime: ${time||'Not verified'} (Central)\nJob: JK123\nCustomer: Synthetic Customer\nTruck: #4\nStatus: ${status}`,schedule:info(date,time,status)}});
 const publish=async(scope:string,observations:PushBatch['observations'],complete=true)=>{const number=(sequence.get(scope)||0)+1;sequence.set(scope,number);await recordPushBatch({scope,category:'schedule',complete,sequence:number,observedAt:new Date(formatTime+=100).toISOString(),observations},formatDeps);};
 const latest=async(scope:string)=>(await p.query('SELECT notification_json FROM opscenter_kernel.push_events WHERE source_scope=$1 ORDER BY source_recorded_at DESC LIMIT 1',[scope])).rows[0].notification_json;
 const beforeFormats=sends;
 await publish(oldScope,[item('move-removal-first',oldDate,'04:00 PM - 05:00 PM')]);await publish(newScope,[]);
 await publish(oldScope,[],false);assert.equal((await latest(oldScope)).title,'Schedule updated','partial absence is silent');
 await publish(oldScope,[]);assert.equal((await latest(oldScope)).title,'Schedule changed');assert.match((await latest(oldScope)).body,/not verified/);
 await publish(newScope,[item('move-removal-first',newDate)]);
 assert.equal((await latest(newScope)).title,'Rescheduled');assert.match((await latest(newScope)).body,new RegExp(`^To: ${newDate}, 12:00 PM - 01:00 PM`));assert.ok((await latest(newScope)).body.includes(`From: ${oldDate}, 04:00 PM - 05:00 PM`));
 // Destination first: retained destination detail is used after verified removal.
 const a=`schedule:${oldDate}:market-477`,b=`schedule:${newDate}:market-477`;
 await publish(a,[item('move-destination-first',oldDate)]);await publish(b,[]);
 await publish(b,[item('move-destination-first',newDate)]);assert.equal((await latest(b)).title,'Schedule updated');
 await publish(a,[]);assert.equal((await latest(a)).title,'Rescheduled');assert.ok((await latest(a)).body.includes('Customer: Synthetic Customer'));
 // Explicit cancellation/removal, unknown time, fresh same-day time change.
 const c=`schedule:${oldDate}:market-399`,e=`schedule:${newDate}:market-399`;
 await publish(c,[item('cancelled',oldDate),item('removed',oldDate),item('unknown',oldDate),item('same-day',oldDate)]);await publish(e,[]);
 await publish(c,[item('cancelled',oldDate,undefined,'Cancelled'),item('removed',oldDate,undefined,'Removed'),item('same-day',oldDate,'02:00 PM - 03:00 PM')]);
 const messages=(await p.query('SELECT notification_json FROM opscenter_kernel.push_events WHERE source_scope=$1',[c])).rows.map(r=>r.notification_json);
 for(const title of ['Cancelled','Removed from schedule','Schedule changed','Rescheduled'])assert.ok(messages.some(m=>m.title===title),title);
 await publish(e,[item('unknown',newDate,'')]);assert.notEqual((await latest(e)).title,'Rescheduled');assert.match((await latest(e)).body,/Not verified/);
 assert.equal((await p.query("SELECT count(*)::int AS count FROM opscenter_kernel.push_deliveries d JOIN opscenter_kernel.push_events e ON e.id=d.event_id WHERE e.source_scope=ANY($1::text[])",[[oldScope,newScope,a,b,c,e]])).rows[0].count,0);
 assert.equal(sends,beforeFormats,'formatting tests never invoke transport');
 console.log('PASS: isolated DB verified cross-date moves in both publication orders, same-day change, partial absence, cancellation/removal, unknown destination, retained details and no recipients/deliveries.');
 }
 console.log('PASS: retirement scan gate: 100 unchanged wakes, eligibility changes, old backlog and cutoff rollover.');
 console.log('PASS: fourteen-day Chicago boundary, pending-delivery and retained-file guards, orphan-gap retirement, compact replay floor, and file-complete/DB-rollback restart recovery.');
 console.log('PASS: independent malformed/expired-scope probes, same-file isolation, restart quarantine, eight-day retained catch-up, fleet removal restraint and explicit generation reset.');
 console.log('PASS: Python publication hooks -> retained burst journal -> DB NOTIFY -> mocked sender, restart replay, live filesystem wake, disabled no-I/O, replay checkpoint and closed-scope retention.');
 console.log('PASS: real PostgreSQL isolated cluster: baseline, versions/reversion, removal completeness, dedup, zero-claim race, scope failure, in-flight revoke, commit NOTIFY, burst fanout, single leader, restart catch-up, uncertain recovery and 410 expiry. All sender calls mocked.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await stop?.();await pool?.end();if(started)pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);fs.rmSync(root,{recursive:true,force:true});});
