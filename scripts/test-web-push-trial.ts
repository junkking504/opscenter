import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Pool,Client } from 'pg';
import { controlPushTrial,readPushTrial,trialFingerprint } from '../lib/web-push-trial';
import { managePushDevice,listPushDevices } from '../lib/web-push-store';
import { drainPushOutbox,recordPushBatch,type PushWorkerDependencies } from '../lib/web-push-worker';
import { startPushDispatcher } from '../lib/web-push-dispatcher';
// Private, disposable PostgreSQL cluster; no protected environment, real endpoint,
// credentials, browser subscription or network sender. Resets occur ONLY between
// independent test cases. Every case retains its durable budget across all sends.
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ops-trial-test-')),socket=path.join(root,'socket'),data=path.join(root,'db');fs.mkdirSync(socket);
const env:NodeJS.ProcessEnv={NODE_ENV:'test',PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C',LC_ALL:'C'};
const pg=(cmd:string,args:string[])=>execFileSync(path.join(process.env.OPSCENTER_TEST_POSTGRES_BIN||'/opt/homebrew/opt/postgresql@18/bin',cmd),args,{env,stdio:'pipe'});
let started=false,pool:Pool,stop:(()=>Promise<void>)|undefined;
const sub=(n:number)=>({endpoint:'https://web.push.apple.com/Q'+String(n).repeat(64),keys:{p256dh:'synthetic',auth:'synthetic'}});
const ref='isolated synthetic test approval';
let sends=0;
async function main(){
 pg('initdb',['-D',data,'--no-locale','-A','trust','-U','push_test']);pg('pg_ctl',['-D',data,'-l',path.join(root,'server.log'),'-o',`-h '' -k ${socket} -p 5432`,'-w','start']);started=true;
 const bootstrap=new Pool({host:socket,user:'push_test',database:'postgres'});try{await bootstrap.query('CREATE DATABASE opscenter_trial_preview_test');}finally{await bootstrap.end();}const config={host:socket,user:'push_test',database:'opscenter_trial_preview_test'};pool=new Pool(config);const p=pool;
 const reset=async()=>{await p.query('DROP SCHEMA IF EXISTS opscenter_kernel CASCADE; CREATE SCHEMA opscenter_kernel');for(const file of fs.readdirSync('lib/platform/persistence/migrations').filter(n=>/^\d+.*sql$/.test(n)).sort())await p.query(fs.readFileSync(path.join('lib/platform/persistence/migrations',file),'utf8'));sends=0;};
 const candidate=(n:number,owner='owner')=>managePushDevice(owner,{action:'subscribe',subscription:sub(n),categories:['schedule'],expiresAt:new Date(Date.now()+3600000)},p);
 const approve=(id:string,n:number,minutes=30)=>controlPushTrial({action:'approve',owner:'owner',deviceId:id,fingerprint:trialFingerprint(sub(n)),expiresInMinutes:minutes},ref,p);
 const prepare=()=>controlPushTrial({action:'prepare',owner:'owner'},ref,p);
 const start=()=>controlPushTrial({action:'start'},ref,p);
 const state=async()=>(await p.query('SELECT * FROM opscenter_kernel.push_trial')).rows[0];
 const d:PushWorkerDependencies={pool:p,enabled:()=>true,ownerAllowed:o=>o==='owner',activatedAt:new Date(Date.now()-60000).toISOString(),send:async(_endpoint,authorize)=>{assert.equal(await authorize(),true);sends++;return 201;}};
 const queue=async(id:string,count=1,prefix='event')=>{for(let n=0;n<count;n++){const event=prefix+n;await p.query("INSERT INTO opscenter_kernel.push_events(id,category,occurred_at,source_recorded_at) VALUES($1,'schedule',clock_timestamp(),clock_timestamp())",[event]);await p.query('INSERT INTO opscenter_kernel.push_deliveries(event_id,device_id) VALUES($1,$2)',[event,id]);}};
 const ready=async()=>{await prepare();const id=await candidate(1);await approve(id,1);await start();return id;};
 await reset();assert.equal((await readPushTrial('owner',p)).status,'unprepared');assert.equal((await state()).started_at,null);await assert.rejects(candidate(1),/trial_enrollment_closed/);await assert.rejects(start(),/approved_device_required/);
 await prepare();await assert.rejects(candidate(2,'another-owner'),/trial_enrollment_closed/);assert.equal((await readPushTrial('another-owner',p)).status,'not_allowed');
 const candidates=await Promise.all([candidate(1),candidate(2)]);assert.equal(new Set(candidates).size,2);assert.equal((await state()).device_id,null,'first enrollment never approves');assert.ok((await listPushDevices('owner',p)).every(d=>!d.approved));
 await queue(candidates[0],1,'unapproved');await drainPushOutbox(d);assert.equal(sends,0);await assert.rejects(start(),/approved_device_required/);
 await assert.rejects(controlPushTrial({action:'approve',owner:'owner',deviceId:candidates[0],fingerprint:trialFingerprint(sub(2)),expiresInMinutes:30},ref,p),/device_verification_failed/);
 await approve(candidates[0],1);await assert.rejects(candidate(2),/different_device_not_approved/);await assert.rejects(candidate(3),/different_device_not_approved/);
 await assert.rejects(managePushDevice('owner',{action:'subscribe',subscription:{...sub(1),keys:{p256dh:'changed',auth:'changed'}},categories:['schedule'],expiresAt:new Date(Date.now()+60000)},p),/different_device_not_approved/);
 await queue(candidates[0],1,'before-start');await drainPushOutbox(d);assert.equal(sends,0);assert.equal((await state()).started_at,null);
 await start();const firstStart=(await state()).started_at;await assert.rejects(start(),/trial_cannot_restart/);await queue(candidates[1],1,'competitor');await drainPushOutbox(d);assert.equal(sends,0);
 await queue(candidates[0],8,'race');await Promise.all([drainPushOutbox(d),drainPushOutbox(d)]);assert.equal(sends,3,'concurrent workers cannot exceed three');assert.equal((await state()).attempts_used,3);assert.equal(Number((await p.query('SELECT count(*) FROM opscenter_kernel.push_trial_attempts')).rows[0].count),3);await drainPushOutbox(d);assert.equal(sends,3);assert.deepEqual((await state()).started_at,firstStart);await assert.rejects(approve(candidates[1],2),/trial_closed/);await assert.rejects(candidate(1),/trial_enrollment_closed/);
 console.log('PASS: inert migration; owner isolation; concurrent candidates never auto-approved; exact fingerprint; competitor/key-rotation rejection; explicit start; concurrent lifetime cap.');
 await reset();let id=await ready();await queue(id,1,'uncertain');await drainPushOutbox({...d,send:async()=>{sends++;throw new Error('unknown');}});assert.equal((await state()).attempts_used,1);assert.equal((await p.query("SELECT status FROM opscenter_kernel.push_deliveries WHERE event_id='uncertain0'")).rows[0].status,'uncertain');
 // Simulate termination after durable reservation but before receipt. A fresh
 // dispatcher recovers sending to uncertain and cannot refund/replay the slot.
 await p.query("UPDATE opscenter_kernel.push_deliveries SET status='sending' WHERE event_id='uncertain0'");await queue(id,4,'restart');const dispatcher=await startPushDispatcher(d,new Client(config));stop=dispatcher.stop;for(let n=0;n<200&&sends<3;n++)await new Promise(r=>setTimeout(r,10));await stop();stop=undefined;
 assert.equal(sends,3);assert.equal((await state()).attempts_used,3);assert.equal((await p.query("SELECT status FROM opscenter_kernel.push_deliveries WHERE event_id='uncertain0'")).rows[0].status,'uncertain');await drainPushOutbox(d);assert.equal(sends,3);
 console.log('PASS: unknown outcome and interrupted receipt retain reservations across dispatcher restart; no uncertain retry.');
 await reset();await prepare();const a=await candidate(1),b=await candidate(2);await approve(a,1);await start();await queue(a,1,'first');await drainPushOutbox(d);const before=await state();await queue(a,1,'oldpending');await approve(b,2);assert.deepEqual((await state()).started_at,before.started_at);assert.deepEqual((await state()).deadline,before.deadline);assert.equal((await state()).attempts_used,1);await drainPushOutbox(d);assert.equal(sends,1);await queue(b,3,'replacement');await drainPushOutbox(d);assert.equal(sends,3);assert.equal((await state()).attempts_used,3);
 console.log('PASS: explicit replacement skips old pending work and preserves the original clock and consumed budget.');
 await reset();id=await ready();await queue(id,1,'revoke');await drainPushOutbox({...d,send:async(endpoint,authorize)=>{await managePushDevice('owner',{action:'unsubscribe',deviceId:id,expiresAt:new Date()},p);assert.equal(await authorize(),false);return 0;}});assert.equal(sends,0);assert.equal((await state()).attempts_used,1);assert.equal((await state()).device_id,null);await candidate(1);assert.equal((await state()).device_id,null,'re-enrollment cannot restore approval');await queue(id,1,'re-enrolled');await drainPushOutbox(d);assert.equal(sends,0);
 await reset();id=await ready();await queue(id,1,'expires-before-io');await drainPushOutbox({...d,send:async(_endpoint,authorize)=>{await p.query("UPDATE opscenter_kernel.push_devices SET expires_at=clock_timestamp()-interval '1 second'");assert.equal(await authorize(),false);return 0;}});assert.equal(sends,0);await assert.rejects(candidate(1),/new_device_approval_required/);const expiredState=await state();await controlPushTrial({action:'revoke',owner:'owner',deviceId:id},ref,p);await candidate(1);assert.equal((await state()).device_id,null);assert.equal((await state()).attempts_used,expiredState.attempts_used);assert.deepEqual((await state()).deadline,expiredState.deadline);
 await reset();await prepare();id=await candidate(1);await approve(id,1,1);const short=(await p.query('SELECT expires_at FROM opscenter_kernel.push_devices WHERE id=$1',[id])).rows[0].expires_at;await start();await candidate(1);assert.deepEqual((await p.query('SELECT expires_at FROM opscenter_kernel.push_devices WHERE id=$1',[id])).rows[0].expires_at,short,'saving cannot extend short approval');
 console.log('PASS: pre-network revocation and device expiry rechecked; re-enrollment needs new approval; one-minute acceptance expiry cannot be extended by browser saves.');
 await reset();id=await ready();await queue(id,1,'expired');await p.query("UPDATE opscenter_kernel.push_trial SET started_at=statement_timestamp()-interval '31 minutes',deadline=statement_timestamp()-interval '1 minute'");await drainPushOutbox(d);assert.equal(sends,0);assert.equal((await state()).attempts_used,0);assert.equal((await readPushTrial('owner',p)).status,'expired');await assert.rejects(candidate(1),/trial_enrollment_closed/);
 await reset();id=await ready();await queue(id,1,'stopped');await controlPushTrial({action:'stop'},ref,p);await drainPushOutbox(d);assert.equal(sends,0);await assert.rejects(start(),/trial_cannot_restart/);assert.equal((await readPushTrial('owner',p)).status,'stopped');
 // Fresh fan-out never uses account membership as device approval and never
 // delivers pretrial history. Only approved post-start canonical facts fan out.
 await reset();await prepare();const one=await candidate(1),two=await candidate(2);await approve(one,1);await start();const day=new Date().toISOString().slice(0,10);const occurred=new Date(Date.now()-10000).toISOString();
 await recordPushBatch({scope:`schedule:${day}`,category:'schedule',sequence:1,baseline:false,complete:true,observedAt:occurred,observations:[{identity:'one',revision:'before'}]},d);assert.equal((await p.query('SELECT * FROM opscenter_kernel.push_deliveries')).rows.length,0);
 await recordPushBatch({scope:`schedule:${day}`,category:'schedule',sequence:2,complete:true,observedAt:new Date().toISOString(),observations:[{identity:'one',revision:'after'}]},d);const rows=(await p.query('SELECT device_id FROM opscenter_kernel.push_deliveries')).rows;assert.deepEqual(rows.map(r=>r.device_id),[one]);assert.notEqual(one,two);await drainPushOutbox(d);assert.equal(sends,1);
 // Waiting on the device lock must not retain a stale trial clock.
 await reset();id=await ready();await queue(id,1,'lock-deadline');await p.query("UPDATE opscenter_kernel.push_trial SET started_at=statement_timestamp()-interval '30 minutes'+interval '150 milliseconds',deadline=statement_timestamp()+interval '150 milliseconds'");
 const held=await p.connect();await held.query('BEGIN');await held.query('SELECT id FROM opscenter_kernel.push_devices WHERE id=$1 FOR UPDATE',[id]);const waiting=drainPushOutbox(d);await new Promise(r=>setTimeout(r,250));await held.query('COMMIT');held.release();await waiting;assert.equal(sends,0);assert.equal((await state()).attempts_used,0,'deadline after lock wait prevents reservation');
 console.log('PASS: deadline, stopped trial, canonical fan-out approval and pretrial-history exclusion. All sends mocked; no handset delivery tested.');
 // Promotion preserves the historical trial and binds ongoing delivery to the
 // same handset. More than three ongoing events use a separate durable ledger.
 await reset();id=await ready();await queue(id,1,'accepted-trial');await drainPushOutbox(d);
 const historical=await state(),oldToken=(await p.query('SELECT claim_token FROM opscenter_kernel.push_trial_attempts')).rows[0].claim_token;
 const promote=()=>controlPushTrial({action:'promote',owner:'owner',deviceId:id,fingerprint:trialFingerprint(sub(1)),verifiedEnrollmentExpiresAt:new Date(Date.now()+3600000),handsetConfirmed:true},ref,p);
 await queue(id,1,'before-promotion');await promote();
 assert.equal((await readPushTrial('owner',p)).status,'ongoing');assert.equal((await readPushTrial('owner',p)).maxAttempts,null);
 assert.deepEqual((await state()).deadline,historical.deadline);assert.deepEqual((await state()).started_at,historical.started_at);assert.equal((await state()).attempts_used,1);
 assert.equal((await p.query("SELECT status FROM opscenter_kernel.push_deliveries WHERE event_id='before-promotion0'")).rows[0].status,'skipped');
 await new Promise(r=>setTimeout(r,5));await queue(id,5,'ongoing');await Promise.all([drainPushOutbox(d),drainPushOutbox(d)]);
 assert.equal(sends,6);assert.equal((await state()).attempts_used,1);assert.equal(Number((await p.query('SELECT count(*) FROM opscenter_kernel.push_ongoing_attempts')).rows[0].count),5);
 await drainPushOutbox(d);assert.equal(sends,6,'no repeated or uncertain retry');
 await assert.rejects(candidate(2),/different_device_not_approved/);await assert.rejects(promote(),/verified_handset_required/);
 const ongoingExpiry=(await state()).ongoing_expires_at;await candidate(1);assert.deepEqual((await state()).ongoing_expires_at,ongoingExpiry,'browser save cannot extend ongoing approval');
 await p.query("UPDATE opscenter_kernel.push_trial SET started_at=statement_timestamp()-interval '31 minutes',deadline=statement_timestamp()-interval '1 minute'");
 await queue(id,1,'past-trial');await drainPushOutbox(d);assert.equal(sends,7,'ongoing mode is independent of preserved trial deadline');
 await queue(id,1,'ongoing-revoke');await drainPushOutbox({...d,send:async(_endpoint,authorize)=>{await managePushDevice('owner',{action:'unsubscribe',deviceId:id,expiresAt:new Date()},p);assert.equal(await authorize(),false);return 0;}});
 assert.equal(sends,7);assert.equal((await readPushTrial('owner',p)).status,'ongoing_revoked');await assert.rejects(candidate(1),/new_device_approval_required/);
 await reset();await prepare();id=await candidate(1);await approve(id,1);await start();await assert.rejects(promote(),/accepted_trial_required/);
 await queue(id,1,'accept');await drainPushOutbox(d);await promote();
 await p.query("UPDATE opscenter_kernel.push_trial SET ongoing_started_at=clock_timestamp()-interval '1 hour',ongoing_expires_at=clock_timestamp()-interval '1 second'");
 await queue(id,1,'ongoing-expired');await drainPushOutbox(d);assert.equal(sends,1);assert.equal((await readPushTrial('owner',p)).status,'ongoing_expired');await assert.rejects(candidate(1),/trial_enrollment_closed/);
 // Same-day clock/fleet changes recovered after pause/promotion must not
 // flood the phone. The first subsequent uninterrupted transition may notify.
 await reset();id=await ready();await p.query("UPDATE opscenter_kernel.push_devices SET categories=ARRAY['schedule','krewe','fleet']");
 await queue(id,1,'accepted-pause');await drainPushOutbox(d);
 const gapDay=new Date().toISOString().slice(0,10),oldTime=new Date(Date.now()-30000).toISOString();
 for(const category of ['krewe','fleet'] as const)await recordPushBatch({scope:`${category}:${gapDay}`,category,sequence:1,baseline:true,complete:true,observedAt:oldTime,observations:[{identity:'original',revision:'before'}]},d);
 await promote();const beforeRecovery=sends;
 for(const category of ['krewe','fleet'] as const)await recordPushBatch({scope:`${category}:${gapDay}`,category,sequence:2,reconcile:true,complete:true,observedAt:oldTime,recordedAt:new Date().toISOString(),observations:[{identity:'original',revision:'while-paused'},{identity:'old-new-row',revision:'before-promotion'}]},d);
 await drainPushOutbox(d);assert.equal(sends,beforeRecovery,'recovered pre-promotion facts never fan out in ongoing mode');
 await new Promise(r=>setTimeout(r,5));await recordPushBatch({scope:`fleet:${gapDay}`,category:'fleet',sequence:3,complete:true,observedAt:new Date().toISOString(),observations:[{identity:'original',revision:'genuine-post-baseline'},{identity:'old-new-row',revision:'before-promotion'}]},d);
 await drainPushOutbox(d);assert.equal(sends,beforeRecovery+1,'future live change follows the fresh baseline');
 console.log('PASS: pause/promote/resume suppresses same-day fleet and crew history; a later uninterrupted change sends once.');
 // A retained descriptive observation reaches only the approved handset;
 // updating display metadata alone cannot create a business event.
 await reset();id=await ready();await queue(id,1,'accepted-details');await drainPushOutbox(d);await promote();
 const detailedDay=new Date().toISOString().slice(0,10),detailScope=`schedule:${detailedDay}:market-352`;
 const detail={identity:'synthetic-job',revision:'one',notification:{title:'Schedule updated',body:'JK123 · Truck: 2 → 4'}};
 await recordPushBatch({scope:detailScope,category:'schedule',sequence:1,baseline:false,complete:true,observedAt:new Date().toISOString(),observations:[detail]},d);
 let received=false;await drainPushOutbox({...d,send:async(endpoint,authorize,_deadline,envelope)=>{assert.equal(await authorize(),true);assert.equal(envelope?.subscription.endpoint,endpoint);assert.equal(envelope?.message.body,detail.notification.body);assert.match(envelope?.message.eventId||'',/^[a-f0-9]{64}$/);received=true;return 201;}});assert.equal(received,true);
 const eventCount=Number((await p.query('SELECT count(*) FROM opscenter_kernel.push_events')).rows[0].count);
 await recordPushBatch({scope:detailScope,category:'schedule',sequence:2,complete:true,observedAt:new Date().toISOString(),observations:[{...detail,notification:{title:'Schedule updated',body:'JK123 · Truck 4'}}]},d);
 assert.equal(Number((await p.query('SELECT count(*) FROM opscenter_kernel.push_events')).rows[0].count),eventCount);
 await recordPushBatch({scope:detailScope,category:'schedule',sequence:3,complete:true,observedAt:new Date().toISOString(),observations:[]},d);
 const removal=(await p.query("SELECT notification_json FROM opscenter_kernel.push_events WHERE notification_json->>'title'='Schedule changed'")).rows[0];assert.match(removal.notification_json.body,/JK123/);assert.match(removal.notification_json.body,/Cancellation or new date\/time not verified/);
 console.log('PASS: exact verified-handset promotion requires accepted trial; five concurrent ongoing sends; trial history preserved; no replay; competing phone rejected; saves cannot renew; revocation and expiry stop ongoing delivery.');

}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await stop?.();await pool?.end();if(started)pg('pg_ctl',['-D',data,'-m','immediate','-w','stop']);fs.rmSync(root,{recursive:true,force:true});});
