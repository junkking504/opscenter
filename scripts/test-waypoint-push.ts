import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync} from 'node:child_process';import {randomUUID,createECDH} from 'node:crypto';import {Pool} from 'pg';
import {manageWaypointPush,recordWaypointChanges,saveWaypointMessage,waypointMessages,waypointPushEnabled,waypointPushReady,waypointNotificationOwner,waypointNotificationStatus,retainWaypointPush} from '../lib/waypoint-push';
import {drainWaypointPush} from '../lib/waypoint-push-worker';
import {chicagoDateKey} from '../lib/chicago-date';
import {createCrewPhoneEnrollment,enrollCrewPhone,revokeCrewPhone} from '../lib/crew-phone-store';
import {saveCrewDay} from '../lib/crew-phone-day';
import {activeNotificationPhone} from '../lib/waypoint-push';
import type {CrewPhone} from '../lib/crew-phone';import type {CrewCurrent} from '../lib/crew-dispatch';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'waypoint-push-test-')),socket=path.join(root,'socket'),data=path.join(root,'db');fs.mkdirSync(socket);
const env:NodeJS.ProcessEnv={NODE_ENV:'test',PATH:process.env.PATH,LANG:'C',LC_ALL:'C'},bin='/opt/homebrew/opt/postgresql@18/bin';
const pg=(name:string,args:string[])=>execFileSync(path.join(bin,name),args,{env,stdio:'pipe'});let pool:Pool|undefined,started=false;
async function main(){
 const policy=path.join(root,'policy');fs.mkdirSync(policy,{mode:0o700});
 fs.writeFileSync(path.join(policy,'config.json'),JSON.stringify({schema:1,enabled:true,expiresAt:Date.now()+3600000}),{mode:0o600});assert.equal(waypointPushEnabled(policy),true);assert.equal(waypointPushReady(policy),false);
 fs.writeFileSync(path.join(policy,'ready.json'),JSON.stringify({until:Date.now()+4000}),{mode:0o600});assert.equal(waypointPushReady(policy),true);fs.chmodSync(path.join(policy,'config.json'),0o644);assert.equal(waypointPushEnabled(policy),false);
 pg('initdb',['-D',data,'--no-locale','-A','trust','-U','waypoint_test']);pg('pg_ctl',['-D',data,'-l',path.join(root,'server.log'),'-o',`-h '' -k ${socket} -p 5432`,'-w','start']);started=true;pg('createdb',['-h',socket,'-U','waypoint_test','waypoint_preview_test']);
 pool=new Pool({host:socket,user:'waypoint_test',database:'waypoint_preview_test'});const p=pool;await p.query('CREATE SCHEMA opscenter_kernel');await p.query(fs.readFileSync('lib/platform/persistence/migrations/0011_waypoint_push.sql','utf8'));await p.query(fs.readFileSync('lib/platform/persistence/migrations/0013_waypoint_update_context.sql','utf8'));
 const phone:CrewPhone={deviceId:randomUUID(),truck:'Truck 1',label:'Synthetic',enrolledAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()};
 let current=phone,live=true;const active=()=>live?{...current,access:'live' as const,state:'active' as const}:null;
 const key=createECDH('prime256v1');key.generateKeys();const subscription={endpoint:'https://web.push.apple.com/Q'+'a'.repeat(24),keys:{p256dh:key.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};
 const auth={ready:()=>true,active};
 const registration=await manageWaypointPush(phone,{action:'subscribe',subscription,notificationKey:'a'.repeat(64)},p,auth);const device=registration.deviceId!;
 assert.equal((await manageWaypointPush(phone,{action:'subscribe',subscription,notificationKey:'a'.repeat(64)},p,auth)).deviceId,device);
 await assert.rejects(manageWaypointPush(phone,{action:'subscribe',subscription,notificationKey:'b'.repeat(64)},p,auth),/another phone/);
 await assert.rejects(manageWaypointPush(phone,{action:'subscribe',subscription,notificationKey:'a'.repeat(64)},p,{...auth,ready:()=>false}),/not available/);
 const job={appointmentId:'1',status:'Confirmed',appointmentTime:'8 AM',address:'Synthetic',appointmentNotes:[],junkItems:[],routePosition:1,date:chicagoDateKey(),jkNumber:'test',customerName:'Synthetic',phone:'',driver:'',navigator:''};
 let snapshot:CrewCurrent={state:'waiting',truck:phone.truck,job:null,observedAt:new Date().toISOString(),jobs:[job]};
 const source={active,snapshot:()=>snapshot,messages:(truck:string)=>waypointMessages(truck,p)};
 const counts=async()=>Number((await p.query('SELECT count(*) FROM opscenter_kernel.waypoint_push_deliveries')).rows[0].count);
 await recordWaypointChanges(p,source);assert.equal(await counts(),0,'Initial schedule and old messages are silent');
 await recordWaypointChanges(p,source);assert.equal(await counts(),0,'Identical snapshots are silent');
 snapshot={...snapshot,jobs:[{...job,appointmentTime:'10 AM'}]};await recordWaypointChanges(p,source);assert.equal(await counts(),1);
 let sends=0;const send=async(_endpoint:string,authorize:()=>Promise<boolean>)=>{assert.equal(await authorize(),true);sends++;return 201;};
 const workerPhones={active:(_id:string,truck?:string)=>live && (!truck || truck===current.truck)?active():null,owner:()=> waypointNotificationOwner('a'.repeat(64))};
 await drainWaypointPush(p,()=>true,send,workerPhones);await drainWaypointPush(p,()=>true,send,workerPhones);assert.equal(sends,1,'Accepted delivery not replayed');
 const message={id:randomUUID(),truck:'Truck 1',body:'Synthetic office instruction',date:chicagoDateKey()};await saveWaypointMessage(message,'synthetic-manager',p);await saveWaypointMessage(message,'synthetic-manager',p);assert.equal((await waypointMessages('Truck 1',p)).length,1,'Message replay is idempotent');assert.equal((await waypointMessages('Truck 2',p)).length,0,'Other truck cannot read message');
 await assert.rejects(saveWaypointMessage({...message,body:'Different'},'synthetic-manager',p),/another message/);
 snapshot={...snapshot,state:'unavailable',jobs:[]};await recordWaypointChanges(p,source);assert.equal(await counts(),2,'Office update queues even when schedule is unavailable; outage is not cancellation');
 await drainWaypointPush(p,()=>true,async()=>{sends++;throw Error('Synthetic lost acceptance');},workerPhones);await drainWaypointPush(p,()=>true,send,workerPhones);assert.equal(sends,2,'Uncertain delivery not replayed');
 // A genuine verified removal is eligible; switching trucks blocks its old queue.
 snapshot={...snapshot,state:'waiting',jobs:[]};await recordWaypointChanges(p,source);assert.equal(await counts(),3);
 current={...phone,truck:'Truck 2'};await drainWaypointPush(p,()=>true,send,workerPhones);assert.equal(sends,2,'Old truck queue denied after switch');await recordWaypointChanges(p,source);assert.equal(await counts(),3,'New truck starts silent baseline');
 snapshot={...snapshot,jobs:[job]};await recordWaypointChanges(p,source);live=false;await recordWaypointChanges(p,source);assert.equal((await p.query('SELECT enabled FROM opscenter_kernel.waypoint_push_devices WHERE id=$1',[device])).rows[0].enabled,true,'Daily expiry preserves opt-in while delivery pauses');await drainWaypointPush(p,()=>true,send,workerPhones);assert.equal(sends,2,'Expired daily access denies send');
 live=true;const baselineBefore=(await p.query('SELECT * FROM opscenter_kernel.waypoint_push_baselines WHERE device_id=$1 ORDER BY kind',[device])).rows;await manageWaypointPush(phone,{action:'restore',endpoint:subscription.endpoint,deviceId:device,notificationKey:'a'.repeat(64)},p,auth);assert.deepEqual((await p.query('SELECT * FROM opscenter_kernel.waypoint_push_baselines WHERE device_id=$1 ORDER BY kind',[device])).rows,baselineBefore,'Unchanged restore preserves baselines');await manageWaypointPush(phone,{action:'unsubscribe',deviceId:device,notificationKey:'a'.repeat(64)},p,auth);snapshot={...snapshot,jobs:[]};await recordWaypointChanges(p,source);await drainWaypointPush(p,()=>true,send,workerPhones);assert.equal(sends,2,'Disabled subscription denied');
 assert.equal((await manageWaypointPush(phone,{action:'restore',endpoint:subscription.endpoint,deviceId:device,notificationKey:'a'.repeat(64)},p,auth)).enabled,false,'Automatic restore cannot undo disable');
 await manageWaypointPush(phone,{action:'subscribe',subscription,notificationKey:'a'.repeat(64)},p,auth);
 await recordWaypointChanges(p,source);
 await saveWaypointMessage({id:randomUUID(),truck:'Truck 2',body:'Synthetic message during source parse failure',date:chicagoDateKey()},'synthetic-manager',p);
 const before=await counts();await recordWaypointChanges(p,{...source,snapshot:()=>{throw Error('Synthetic source parse failure');}});assert.equal(await counts(),before+1,'Malformed schedule cannot suppress independent office message');
 await drainWaypointPush(p,()=>true,send,workerPhones);assert.equal(sends,3);
 snapshot={...snapshot,jobs:[job]};await recordWaypointChanges(p,source);
 await drainWaypointPush(p,()=>true,async()=>{await p.query('UPDATE opscenter_kernel.waypoint_push_devices SET phone_id=$2 WHERE id=$1',[device,randomUUID()]);return 410;},workerPhones);
 assert.equal((await p.query('SELECT enabled FROM opscenter_kernel.waypoint_push_devices WHERE id=$1',[device])).rows[0].enabled,true,'Late expiry of an old binding cannot revoke a replacement');
 const oldEnv={...process.env};try{
 process.env.OPS_CREW_PHONE_DIR=path.join(root,'real-phones');process.env.OPSCENTER_LOGIN_RATE_LIMIT_FILE=path.join(root,'real-rate-limit');process.env.OPS_CREW_ROSTER_JSON='[]';process.env.OPS_WAYPOINT_CREW_EXTRA_NAMES_JSON='["Synthetic Crew"]';
 const realPhones=[];for(const [index,actor] of ['synthetic-manager-a','synthetic-manager-b'].entries()){const invitation=createCrewPhoneEnrollment('Truck 1','Synthetic actual binding',actor),bound=enrollCrewPhone(invitation.code,String(index+1).repeat(64));saveCrewDay(bound,{date:chicagoDateKey(),requestId:randomUUID(),expectedVersion:0,driver:'Synthetic Crew',responsible:'Synthetic Crew',navigators:[]},new Date(),['Synthetic Crew']);realPhones.push(bound);}
 const realSub={...subscription,endpoint:'https://web.push.apple.com/Q'+'c'.repeat(24)},request={action:'subscribe',subscription:realSub,notificationKey:'c'.repeat(64)},realAuth={ready:()=>true,active:activeNotificationPhone};
 const first=await manageWaypointPush(realPhones[0],request,p,realAuth);
 const oldQueue=randomUUID();await p.query("INSERT INTO opscenter_kernel.waypoint_push_deliveries(id,device_id,phone_id,truck,service_date,status) VALUES($1,$2,$3,'Truck 1',$4,'pending')",[oldQueue,first.deviceId,realPhones[0].deviceId,chicagoDateKey()]);
 await p.query("INSERT INTO opscenter_kernel.waypoint_push_baselines(device_id,kind,scope,revision) VALUES($1,'schedule','old-scope','old-revision')",[first.deviceId]);
 // Simulate the old daily session expiring with real filesystem-backed authorization.
 const binding=path.join(process.env.OPS_CREW_PHONE_DIR!,'bindings',realPhones[0].deviceId+'.json'),savedBinding=JSON.parse(fs.readFileSync(binding,'utf8'));
 savedBinding.phone.enrolledAt=new Date(Date.now()-86400000).toISOString();fs.writeFileSync(binding,JSON.stringify(savedBinding));
 await recordWaypointChanges(p,{active:activeNotificationPhone,snapshot:()=>snapshot,messages:async()=>[]});
 assert.equal((await p.query('SELECT enabled FROM opscenter_kernel.waypoint_push_devices WHERE id=$1',[first.deviceId])).rows[0].enabled,true,'Real prior-day binding retains opt-in');
 await assert.rejects(manageWaypointPush(realPhones[0],{action:'restore',endpoint:realSub.endpoint,deviceId:first.deviceId,notificationKey:'c'.repeat(64)},p,realAuth),/not available/,'Expired phone cannot restore itself');
 assert.equal((await manageWaypointPush(realPhones[1],{action:'restore',endpoint:realSub.endpoint,deviceId:first.deviceId,notificationKey:'d'.repeat(64)},p,realAuth)).enabled,false,'Other browser cannot restore');
 const second=await manageWaypointPush(realPhones[1],{action:'restore',endpoint:realSub.endpoint,deviceId:first.deviceId,notificationKey:'c'.repeat(64)},p,realAuth);
 assert.equal((await p.query('SELECT status FROM opscenter_kernel.waypoint_push_deliveries WHERE id=$1',[oldQueue])).rows[0].status,'skipped','Old queue cannot follow new daily binding');
 assert.equal((await p.query('SELECT * FROM opscenter_kernel.waypoint_push_baselines WHERE device_id=$1',[first.deviceId])).rowCount,0,'New daily binding starts a silent baseline');
 assert.equal(first.deviceId,second.deviceId,'Browser ownership survives a different enrolling actor and phone enrollment');
 assert.equal((await waypointNotificationStatus(realPhones[1],'c'.repeat(64),second.deviceId,p)).enabled,true);assert.equal((await waypointNotificationStatus(realPhones[0],'c'.repeat(64),second.deviceId,p)).enabled,false);assert.equal((await waypointNotificationStatus(realPhones[1],'d'.repeat(64),second.deviceId,p)).enabled,false);
 assert.equal((await manageWaypointPush(realPhones[1],{action:'restore',endpoint:'https://web.push.apple.com/changed',deviceId:second.deviceId,notificationKey:'c'.repeat(64)},p,realAuth)).enabled,false,'Mismatched browser endpoint cannot claim connected');
 await p.query("UPDATE opscenter_kernel.waypoint_push_devices SET subscription_json=jsonb_set(subscription_json,'{expirationTime}',to_jsonb($2::bigint)) WHERE id=$1",[second.deviceId,Date.now()-1000]);assert.equal((await manageWaypointPush(realPhones[1],{action:'restore',endpoint:realSub.endpoint,deviceId:second.deviceId,notificationKey:'c'.repeat(64)},p,realAuth)).enabled,false,'Expired browser subscription is not restored');
 const saved=(await p.query('SELECT owner_id,phone_id FROM opscenter_kernel.waypoint_push_devices WHERE id=$1',[second.deviceId])).rows[0];assert.equal(saved.owner_id,waypointNotificationOwner('c'.repeat(64)));assert.equal(saved.phone_id,realPhones[1].deviceId);

 await p.query("UPDATE opscenter_kernel.waypoint_push_devices SET subscription_json=subscription_json-'expirationTime' WHERE id=$1",[second.deviceId]);
 revokeCrewPhone(realPhones[1].deviceId,'synthetic-manager');
 const renewedInvite=createCrewPhoneEnrollment('Truck 1','Synthetic renewed phone','synthetic-manager'),renewed=enrollCrewPhone(renewedInvite.code,'f'.repeat(64));
 saveCrewDay(renewed,{date:chicagoDateKey(),requestId:randomUUID(),expectedVersion:0,driver:'Synthetic Crew',responsible:'Synthetic Crew',navigators:[]},new Date(),['Synthetic Crew']);
 assert.equal((await manageWaypointPush(renewed,{action:'restore',endpoint:realSub.endpoint,deviceId:second.deviceId,notificationKey:'c'.repeat(64)},p,realAuth)).enabled,false,'Revoked old phone cannot restore after re-enrollment, even before the worker runs');
 assert.equal((await p.query('SELECT enabled FROM opscenter_kernel.waypoint_push_devices WHERE id=$1',[second.deviceId])).rows[0].enabled,false);
 const renewedRegistration=await manageWaypointPush(renewed,request,p,realAuth);revokeCrewPhone(renewed.deviceId,'synthetic-manager');
 await recordWaypointChanges(p,{active:activeNotificationPhone,snapshot:()=>snapshot,messages:async()=>[]});
 assert.equal((await p.query('SELECT enabled FROM opscenter_kernel.waypoint_push_devices WHERE id=$1',[renewedRegistration.deviceId])).rows[0].enabled,false,'Worker disables explicitly revoked phones while preserving ordinary daily expiry');
 }finally{process.env=oldEnv;}
 const yesterday=new Date(Date.now()-86400000).toLocaleDateString('en-CA',{timeZone:'America/Chicago'});await p.query('UPDATE opscenter_kernel.waypoint_messages SET service_date=$2 WHERE id=$1',[message.id,yesterday]);await saveWaypointMessage({...message,date:yesterday},'synthetic-manager',p);await assert.rejects(saveWaypointMessage({...message,id:randomUUID(),date:yesterday},'synthetic-manager',p),/previous day/);
 const capKey='e'.repeat(64),capSubscriptions=[];for(let n=0;n<10;n++){const sub={...subscription,endpoint:'https://web.push.apple.com/Q'+String(n).padStart(24,'0')};capSubscriptions.push(sub);await manageWaypointPush(phone,{action:'subscribe',subscription:sub,notificationKey:capKey},p,auth);}
 await assert.rejects(manageWaypointPush(phone,{action:'subscribe',subscription:{...subscription,endpoint:'https://web.push.apple.com/Q'+'z'.repeat(24)},notificationKey:capKey},p,auth),/too many/);
 const disabled=(await p.query("SELECT id FROM opscenter_kernel.waypoint_push_devices WHERE subscription_json->>'endpoint'=$1",[capSubscriptions[0].endpoint])).rows[0].id;
 await manageWaypointPush(phone,{action:'unsubscribe',deviceId:disabled,notificationKey:capKey},p,auth);await manageWaypointPush(phone,{action:'subscribe',subscription:{...subscription,endpoint:'https://web.push.apple.com/Q'+'z'.repeat(24)},notificationKey:capKey},p,auth);
 await assert.rejects(manageWaypointPush(phone,{action:'subscribe',subscription:capSubscriptions[0],notificationKey:capKey},p,auth),/too many/);
 const retired=randomUUID();await p.query("INSERT INTO opscenter_kernel.waypoint_push_devices(id,owner_id,phone_id,endpoint_hash,subscription_json,enabled,updated_at) VALUES($1,'retired',$2,'retired','{}',false,now()-interval '20 days')",[retired,randomUUID()]);await retainWaypointPush(p);assert.equal((await p.query('SELECT id FROM opscenter_kernel.waypoint_push_devices WHERE id=$1',[retired])).rowCount,0);assert.ok((await p.query('SELECT id FROM opscenter_kernel.waypoint_push_devices WHERE id=$1',[device])).rowCount);
 console.log('PASS Waypoint push: private readiness, ownership, idempotent office messages, truck isolation/switch, source outages, new/change/removal snapshots, accepted/uncertain no-replay and expired daily access. Isolated PostgreSQL; no Keychain or provider.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await pool?.end();if(started)pg('pg_ctl',['-D',data,'-m','immediate','-w','stop']);fs.rmSync(root,{recursive:true,force:true});});
