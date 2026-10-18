import assert from 'node:assert/strict';
import { pushDevicesGET,pushDevicesPOST } from '../lib/web-push-api';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createPublicKey,verify } from 'node:crypto';
import { pushEndpoint,pushCategories,pushSubscription,pushEnabled,pushOutcome,pushHash,validPushOrigin } from '../lib/web-push-policy';
import { publicPushAddress,sendAppleWakeup,vapidAuthorization } from '../lib/web-push-transport';
import { pushEventId, type PushBatch } from '../lib/web-push-events';
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
process.env.OPSCENTER_WEB_PUSH_ENABLED='0';await assert.rejects(sendAppleWakeup(endpoint),/disabled/);assert.deepEqual(await runPushWorker([]),{disabled:true,attempted:0});

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
const api={enabled:()=>activation,publicKey:()=>undefined,origin:()=> 'https://ops.example.test',list:async()=>[],manage:async(owner:string)=>{assert.equal(owner,'owner');saves++;return 'fixture-device';}};
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

// In-memory query double: no database, credentials, subscription or network access.
function mockStore() {
 const sources=new Map<string,string>(), observations=new Map<string,{revision_hash:string;version:number}>(),events=new Map<string,{category:string;observed_at:Date}>();
 const device={id:'device',owner_id:'owner',categories:['fleet','schedule'],subscription_json:subscription};
 const deliveries=new Map<string,{event_id:string;device_id:string;status:string}>();let live=true,locked=true;
 const queries:Array<{sql:string;args:unknown[]}>=[];
 const query=async(sql:string,args:unknown[]=[])=>{
  queries.push({sql,args});let rows:unknown[]=[];
  if(sql.includes('pg_try_advisory_lock'))rows=[{locked}];
  else if(sql.startsWith('SELECT scope'))rows=sources.has(String(args[0]))?[{scope:args[0],observed_at:sources.get(String(args[0]))}]:[];
  else if(sql.startsWith('SELECT revision_hash'))rows=observations.has(args.slice(0,2).join('|'))?[observations.get(args.slice(0,2).join('|'))]:[];
  else if(sql.startsWith('INSERT INTO opscenter_kernel.push_observations'))observations.set(args.slice(0,2).join('|'),{revision_hash:String(args[2]),version:Number(args[3])});
  else if(sql.startsWith('INSERT INTO opscenter_kernel.push_sources'))sources.set(String(args[0]),String(args[1]));
  else if(sql.startsWith('INSERT INTO opscenter_kernel.push_events')){if(!events.has(String(args[0]))){events.set(String(args[0]),{category:String(args[1]),observed_at:new Date()});rows=[{id:args[0]}];}}
  else if(sql.startsWith('INSERT INTO opscenter_kernel.push_deliveries'))deliveries.set(String(args[0]),{event_id:String(args[0]),device_id:device.id,status:'pending'});
  else if(sql.startsWith('SELECT DISTINCT ON'))rows=[...deliveries.values()].filter(d=>d.status==='pending').slice(-1).map(d=>({...d,...events.get(d.event_id)}));
  else if(sql.startsWith('SELECT * FROM opscenter_kernel.push_devices'))rows=live?[device]:[];
  else if(sql.startsWith('DELETE FROM opscenter_kernel.push_devices WHERE id'))live=false;
  else if(sql.includes("SET status='uncertain'"))for(const d of deliveries.values()){if(d.status==='sending')d.status='uncertain';}
  else if(sql.includes("SET status='sending'"))for(const d of deliveries.values()){if(d.device_id===args[0] && d.status==='pending')d.status='sending';}
  else if(sql.includes('SET status=$3')){const d=deliveries.get(String(args[0]));if(d)d.status=String(args[2]);}
  else if(sql.includes('SET status=$2'))for(const d of deliveries.values()){if(d.status==='sending')d.status=String(args[1]);}
  return {rows,rowCount:rows.length};
 };
 return {pool:{connect:async()=>({query,release:()=>{}})} as unknown as Pool,queries,deliveries,events,device,get live(){return live;},setLocked:(v:boolean)=>{locked=v;}};
}
const store=mockStore();let sends=0,code=201,throws=false,allowed=true;
const deps={pool:store.pool,enabled:()=>true,send:async()=>{sends++;if(throws)throw new Error('mock timeout');return code;},ownerAllowed:()=>allowed,activatedAt:new Date(Date.now()-60000).toISOString()};
let tick=Date.now()-10000;
const batch=(revision:string):PushBatch=>({scope:'fleet:2026-10-18',category:'fleet',observedAt:new Date(tick+=100).toISOString(),observations:[{identity:'stable-source-id',revision}]});
await runPushWorker([batch('arrival')],deps);assert.equal(sends,0,'first snapshot is a baseline');
await runPushWorker([batch('arrival')],deps);assert.equal(sends,0,'snapshot refresh does not notify');
await runPushWorker([batch('departure')],deps);assert.equal(sends,1);
await runPushWorker([batch('departure')],deps);assert.equal(sends,1,'repeat source revision deduplicates');
await runPushWorker([batch('arrival')],deps);assert.equal(sends,2,'real reversion is a new transition');
throws=true;const concurrent=batch('departure');concurrent.observations.push({identity:'second-source-id',revision:'arrival'});await runPushWorker([concurrent],deps);assert.equal(sends,3);assert.equal([...store.deliveries.values()].filter(d=>d.status==='uncertain').length,2,'all coalesced deliveries reserve before sending');
await runPushWorker([],deps);assert.equal(sends,3,'uncertain attempts are not retried');
throws=false;allowed=false;await runPushWorker([batch('new')],deps);assert.equal(sends,3,'revoked actor cannot receive');
allowed=true;code=410;await runPushWorker([batch('expired')],deps);assert.equal(store.live,false,'expired subscription removed');
store.setLocked(false);assert.deepEqual(await runPushWorker([],deps),{busy:true,attempted:0});
assert.equal(pushEventId(batch('same'),{identity:'x',revision:'same'}),pushEventId(batch('same'),{identity:'x',revision:'same'}));
assert.notEqual(pushHash('one'),pushHash('two'));

const ownerQueries:Array<{sql:string;args:unknown[]}>=[];
const ownerPool={connect:async()=>({release:()=>{},query:async(sql:string,args:unknown[]=[])=>{ownerQueries.push({sql,args});return {rows:sql.startsWith('SELECT id,owner_id')?[{id:'other-device',owner_id:'other-owner'}]:[]};}})} as unknown as Pool;
await assert.rejects(managePushDevice('owner',{action:'subscribe',subscription,categories:['fleet'],expiresAt:new Date()},ownerPool),/another account/);
await managePushDevice('owner',{action:'unsubscribe',deviceId:'other-device',expiresAt:new Date()},ownerPool);
assert.ok(ownerQueries.some(q=>q.sql.includes('DELETE FROM') && q.sql.includes('owner_id=$2') && q.args[1]==='owner'));

const handlers:Record<string,(event:unknown)=>void>={};let shown:unknown;let opened='';
const sw=readFileSync('public/opscenter-push-sw.js','utf8');
vm.runInNewContext(sw,{URL,self:{location:{origin:'https://ops.example.test'},addEventListener:(name:string,fn:(event:unknown)=>void)=>{handlers[name]=fn;},registration:{showNotification:async(title:string,options:unknown)=>{shown={title,options};}},clients:{matchAll:async()=>[],openWindow:async(url:string)=>{opened=url;}}}});
let pending=Promise.resolve();handlers.push({data:{url:'https://evil.test',customer:'Private'},waitUntil:(p:Promise<void>)=>{pending=p;}});await pending;
assert.doesNotMatch(JSON.stringify(shown),/Private|evil/);assert.match(JSON.stringify(shown),/Operational updates are available/);
handlers.notificationclick({notification:{close:()=>{},data:{path:'https://evil.test'}},waitUntil:(p:Promise<void>)=>{pending=p;}});await pending;assert.equal(opened,'https://ops.example.test/desktop?workspace=Command');
assert.equal(handlers.fetch,undefined,'service worker cannot intercept authenticated content');
console.log('Push endpoint, DNS, validation, owner isolation, baseline, transition deduplication, uncertainty, expiry and service-worker mock assertions passed.');

}
main().catch(error=>{console.error(error);process.exitCode=1;});
