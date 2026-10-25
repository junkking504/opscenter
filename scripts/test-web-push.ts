import assert from 'node:assert/strict';
import { pushDevicesGET,pushDevicesPOST } from '../lib/web-push-api';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createPublicKey,verify } from 'node:crypto';
import { pushEndpoint,pushCategories,pushSubscription,pushEnabled,pushEnrollmentEnabled,pushOutcome,pushHash,validPushOrigin } from '../lib/web-push-policy';
import { publicPushAddress,sendAppleWakeup,vapidAuthorization } from '../lib/web-push-transport';
import { pushEventId, pushTransitions, type PushBatch } from '../lib/web-push-events';
import { runPushWorker } from '../lib/web-push-worker';
import { managePushDevice } from '../lib/web-push-store';
import type { Pool } from 'pg';
async function main() {
const endpoint='https://web.push.apple.com/Q'+'x'.repeat(64);
const subscription={endpoint,keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};
assert.equal(pushEndpoint(endpoint).hostname,'web.push.apple.com');
for(const bad of ['http://web.push.apple.com/Q'+'x'.repeat(64),'https://web.push.apple.com.evil.test/Qxxx','https://127.0.0.1/Qxxx',endpoint+'?redirect=x',endpoint+'#x',endpoint.replace('.com/','.com:8443/'),endpoint.replace('https://','https://user@'),'https://web.push.apple.com/../../admin'])assert.throws(()=>pushEndpoint(bad));
for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','100.64.0.1','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicPushAddress(ip),false);
assert.equal(publicPushAddress('17.0.0.1'),true);assert.deepEqual(pushCategories(['fleet','fleet']),['fleet']);assert.throws(()=>pushCategories([]));assert.throws(()=>pushCategories(['payroll']));
assert.equal(pushSubscription(subscription).endpoint,endpoint);assert.throws(()=>pushSubscription({...subscription,expirationTime:1}));assert.throws(()=>pushSubscription({...subscription,keys:{auth:'bad'}}));
assert.equal(validPushOrigin('https://ops.example.test'),true);assert.equal(validPushOrigin('http://ops.example.test'),false);assert.equal(validPushOrigin('https://ops.example.test/path'),false);
assert.equal(pushEnabled({}),false);assert.equal(pushEnabled({OPSCENTER_WEB_PUSH_ENABLED:'1',OPSCENTER_RUNTIME:'MAC_MINI_PREVIEW'}),false);
assert.deepEqual([201,404,410,302,429,500].map(pushOutcome),['accepted','expired','expired','rejected','rejected','rejected']);
process.env.OPSCENTER_WEB_PUSH_ENABLED='0';await assert.rejects(sendAppleWakeup(endpoint,async()=>false,0),/disabled/);assert.deepEqual(await runPushWorker([]),{disabled:true,attempted:0});

// Transport rechecks the durable authorization after DNS and before request.
// Every adapter is synthetic; no DNS, signing secret or network is used.
let transportTime=1000,transportRequests=0,transportChecks=0;
const transportIO={enabled:()=>true,resolve:async()=>[{address:'17.0.0.1',family:4}],authorization:()=> 'synthetic',now:()=>transportTime,request:(()=>{transportRequests++;throw new Error('unexpected network');}) as typeof import('node:https').request};
await assert.rejects(sendAppleWakeup(endpoint,async()=>{transportChecks++;return false;},2000,transportIO),/authorization expired/);
assert.equal(transportChecks,1);assert.equal(transportRequests,0);
await assert.rejects(sendAppleWakeup(endpoint,async()=>true,2000,{...transportIO,resolve:async()=>{transportTime=2000;return [{address:'17.0.0.1',family:4}];}}),/authorization expired/);
assert.equal(transportRequests,0,'deadline consumed by DNS prevents request');
transportTime=1000;
await assert.rejects(sendAppleWakeup(endpoint,async()=>{transportTime=2000;return true;},2000,transportIO),/deadline reached/);
assert.equal(transportRequests,0,'deadline consumed by durable authorization prevents request');
await assert.rejects(sendAppleWakeup(endpoint,async()=>true,3000,{...transportIO,resolve:async()=>[{address:'127.0.0.1',family:4}]}),/DNS rejected/);
assert.equal(transportRequests,0);

// Public mathematical P-256 test fixture (scalar 1), NOT deployable credentials.
// No secret generation, environment configuration or provider request occurs.
const x='6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296';
const y='4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5';
const publicFixture=Buffer.from('04'+x+y,'hex').toString('base64url');
const fixtureEnv={NODE_ENV:'test' as const,OPSCENTER_WEB_PUSH_PUBLIC_KEY:publicFixture,OPSCENTER_WEB_PUSH_PRIVATE_KEY:Buffer.from('00'.repeat(31)+'01','hex').toString('base64url'),OPSCENTER_WEB_PUSH_SUBJECT:'mailto:test@example.test'};
const authorization=vapidAuthorization(pushEndpoint(endpoint),fixtureEnv,1_000_000);
const token=authorization.match(/^vapid t=([^,]+), k=/)![1];const parts=token.split('.');
assert.deepEqual(JSON.parse(Buffer.from(parts[1],'base64url').toString()),{aud:'https://web.push.apple.com',exp:4600,sub:'mailto:test@example.test'});
const publicKey=createPublicKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:Buffer.from(x,'hex').toString('base64url'),y:Buffer.from(y,'hex').toString('base64url')}});
assert.ok(verify('sha256',Buffer.from(parts.slice(0,2).join('.')),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')));

// Exercise the actual HTTP handler with verified-session and persistence doubles.
const actor={email:'owner',role:'manager' as const,expiresAt:new Date(Date.now()+86400000)};
let saves=0;let activation=false;
const api={trial:async()=>({status:'awaiting_device',ownerEligible:true,canRequest:true,deadline:null,attemptsUsed:0,maxAttempts:3,durationMinutes:30}),enabled:()=>activation,publicKey:()=>undefined,origin:()=> 'https://ops.example.test',list:async()=>[],manage:async(owner:string)=>{assert.equal(owner,'owner');saves++;return 'fixture-device';}};
const request=(body:unknown,origin='https://ops.example.test')=>new Request('https://ops.example.test/api/push/devices',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
assert.equal((await pushDevicesGET(null,api)).status,401);
assert.equal((await pushDevicesGET({...actor,role:'operator'},api)).status,403);
assert.equal((await pushDevicesPOST(request({}),null,api)).status,401);
assert.equal((await pushDevicesPOST(request({},'https://evil.test'),actor,api)).status,403);
assert.equal((await pushDevicesPOST(request({},''),actor,api)).status,403);
const enroll={action:'subscribe',subscription,categories:['fleet'],owner:'attacker'};
assert.equal((await pushDevicesPOST(request(enroll),actor,api)).status,503);assert.equal(saves,0);
activation=true;assert.equal((await pushDevicesPOST(request(enroll),actor,api)).status,200);assert.equal(saves,1);
assert.equal((await pushDevicesPOST(request({...enroll,subscription:{endpoint:'http://127.0.0.1'}}),actor,api)).status,400);assert.equal(saves,1);
assert.equal((await pushDevicesPOST(request({padding:'x'.repeat(9000)}),actor,api)).status,413);
activation=false;assert.equal((await pushDevicesPOST(request({action:'unsubscribe',deviceId:'00000000-0000-4000-8000-000000000000'}),actor,api)).status,200,'revoke remains available when sending is disabled');
assert.match((await pushDevicesGET(actor,api)).headers.get('Cache-Control') || '',/no-store/);

// Pure transition assertions complement the real-PostgreSQL race suite.
const batch:PushBatch={scope:'schedule:2026-10-18',category:'schedule',sequence:1,complete:true,observedAt:new Date().toISOString(),observations:[{identity:'A',revision:'one'}]};
const first=pushTransitions(new Map(),batch)[0];
const baseline=new Map([[first.identity,{revision_hash:first.revision,version:1,present:true}]]);
assert.equal(pushTransitions(baseline,batch).length,0);
assert.equal(pushTransitions(baseline,{...batch,observations:[],complete:false}).length,0);
const removed=pushTransitions(baseline,{...batch,observations:[]})[0];assert.equal(removed.present,false);
assert.equal(pushTransitions(new Map([[first.identity,{revision_hash:removed.revision,version:2,present:false}]]),batch)[0].version,3);
assert.throws(()=>pushTransitions(baseline,{...batch,observations:[...batch.observations,...batch.observations]}));
assert.equal(pushEventId(batch,batch.observations[0]),pushEventId(batch,batch.observations[0]));
assert.notEqual(pushHash('one'),pushHash('two'));
const publicConfig={...fixtureEnv,OPSCENTER_RUNTIME:'MISSION_CONTROL',OPSCENTER_WEB_PUSH_ENABLED:'1',OPSCENTER_WEB_PUSH_ORIGIN:'https://ops.example.test',OPSCENTER_WEB_PUSH_ACTIVATED_AT:new Date(Date.now()-1000).toISOString(),OPSCENTER_WEB_PUSH_PRIVATE_KEY:undefined};
assert.equal(pushEnrollmentEnabled(publicConfig),true);assert.equal(pushEnabled(publicConfig),false);
assert.equal(pushEnabled({...publicConfig,...fixtureEnv,OPSCENTER_PROCESS_ROLE:'push-dispatcher'}),true);
const missingStorage=await pushDevicesGET(actor,{...api,list:async()=>{throw new Error('private details');}});
assert.equal(missingStorage.status,200);assert.deepEqual(await missingStorage.json(),{enabled:false,publicKey:null,devices:[],storage:'unavailable'});
const ownerQueries:string[]=[];
const ownerPool={connect:async()=>({release:()=>{},query:async(sql:string)=>{ownerQueries.push(sql);return {rows:sql.includes('push_trial WHERE')?[{owner_id:null}]:sql.includes('clock_timestamp() AS now')?[{now:new Date()}]:[]};}})} as unknown as Pool;
await managePushDevice('owner',{action:'unsubscribe',deviceId:'other-device',expiresAt:new Date()},ownerPool);
assert.ok(!ownerQueries.some(sql=>sql.includes('INSERT INTO opscenter_kernel.push_audit')),'non-owned revoke cannot create misleading audit');

const handlers:Record<string,(event:unknown)=>void>={};let shown:unknown;let opened='';
const sw=readFileSync('public/opscenter-push-sw.js','utf8');
vm.runInNewContext(sw,{URL,self:{location:{origin:'https://ops.example.test'},addEventListener:(name:string,fn:(event:unknown)=>void)=>{handlers[name]=fn;},registration:{showNotification:async(title:string,options:unknown)=>{shown={title,options};}},clients:{matchAll:async()=>[],openWindow:async(url:string)=>{opened=url;}}}});
let pending=Promise.resolve();handlers.push({data:{url:'https://evil.test',customer:'Private'},waitUntil:(p:Promise<void>)=>{pending=p;}});await pending;
assert.doesNotMatch(JSON.stringify(shown),/Private|evil/);assert.match(JSON.stringify(shown),/Operational updates are available/);
handlers.notificationclick({notification:{close:()=>{},data:{path:'https://evil.test'}},waitUntil:(p:Promise<void>)=>{pending=p;}});await pending;assert.equal(opened,'https://ops.example.test/desktop?workspace=Command');
handlers.push({data:{json:()=>({title:'Truck 2 departed',body:'Truck 2 left BRHQ at 10:47 AM',eventId:'a'.repeat(64),url:'https://evil.test'})},waitUntil:(p:Promise<void>)=>{pending=p;}});await pending;assert.match(JSON.stringify(shown),/Truck 2 left BRHQ/);assert.doesNotMatch(JSON.stringify(shown),/evil/);
// The web payload owns title/body only; iOS owns app attribution. No browser or
// OS notification is created: showNotification is the VM double above.
handlers.push({data:{json:()=>({title:'Truck #9',body:'Departed Warehouse: 5:21 PM',eventId:'b'.repeat(64),subtitle:'from OpsCenter'})},waitUntil:(p:Promise<void>)=>{pending=p;}});await pending;
assert.deepEqual(JSON.parse(JSON.stringify(shown)),{title:'Truck #9',options:{
  body:'Departed Warehouse: 5:21 PM',icon:'/opscenter-app-192.png',badge:'/opscenter-app-192.png',
  tag:'opscenter-'+'b'.repeat(64),renotify:true,data:{path:'/desktop?workspace=Command',eventId:'b'.repeat(64)}
}});
assert.doesNotMatch(JSON.stringify(shown),/from OpsCenter/);
const expandedBody='Date: 2026-10-22\nTime: 12 PM – 1 PM (Central)\nJob: JK123\n'+('Detail: verified fixture\n'.repeat(40));
handlers.push({data:{json:()=>({title:'Rescheduled',body:expandedBody,eventId:'c'.repeat(64)})},waitUntil:(p:Promise<void>)=>{pending=p;}});await pending;
assert.equal((shown as {options:{body:string}}).options.body,expandedBody,'multiline details beyond old 700-character cutoff reach showNotification unchanged');
// Actual worker code in a VM: no browser, OS notification or navigation occurs.
const jobPath='/jobs?date=2026-10-22#job-jk123';
handlers.push({data:{json:()=>({title:'Truck #9',body:'Estimate Completed\nPhotos: 5 available in OpsCenter',path:jobPath})},waitUntil:(p:Promise<void>)=>{pending=p;}});await pending;
assert.equal((shown as {options:{data:{path:string}}}).options.data.path,jobPath);
handlers.notificationclick({notification:{close:()=>{},data:{path:jobPath}},waitUntil:(p:Promise<void>)=>{pending=p;}});await pending;
assert.equal(opened,'https://ops.example.test'+jobPath);
for(const path of ['https://evil.test','//evil.test','/jobs?date=2026-02-30#job-jk123','/jobs?date=2026-10-22#job-jk123%0a','/api/private']){
 handlers.push({data:{json:()=>({title:'Fixture',body:'Details',path})},waitUntil:(p:Promise<void>)=>{pending=p;}});await pending;
 assert.equal((shown as {options:{data:{path:string}}}).options.data.path,'/desktop?workspace=Command');
 handlers.notificationclick({notification:{close:()=>{},data:{path}},waitUntil:(p:Promise<void>)=>{pending=p;}});await pending;
 assert.equal(opened,'https://ops.example.test/desktop?workspace=Command');
}
assert.equal(handlers.fetch,undefined,'service worker cannot intercept authenticated content');
console.log('Push endpoint, DNS, validation, owner isolation, baseline, transition deduplication, uncertainty, expiry and service-worker mock assertions passed.');

}
main().catch(error=>{console.error(error);process.exitCode=1;});
