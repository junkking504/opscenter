import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {execFileSync} from 'node:child_process';import {randomUUID} from 'node:crypto';import {Pool} from 'pg';
import {recordWaypointChanges,waypointUpdates} from '../lib/waypoint-push';
import {waypointPushProjection,waypointPushChange} from '../lib/waypoint-push-change';
import {waypointUpdateLabels} from '../lib/waypoint-update-context';
import {drainWaypointPush} from '../lib/waypoint-push-worker';
import type {PushEnvelope} from '../lib/web-push-message';
import {chicagoDateKey} from '../lib/chicago-date';
import type {CrewPhone} from '../lib/crew-phone';
import type {CrewCurrent} from '../lib/crew-dispatch';
const job={appointmentId:'1',status:'Confirmed',appointmentTime:'8 AM',address:'Fictional address',appointmentNotes:['First note','Second note'],junkItems:['Chair'],routePosition:1,date:chicagoDateKey(),jkNumber:'EXAMPLE',customerName:'Fictional Customer',phone:'',driver:'',navigator:''};
const before=waypointPushProjection([job],[]);
assert.equal(waypointPushChange(before,waypointPushProjection([{...job,appointmentNotes:[' Second   note ','First note']}],[]),'schedule').changed,false);
assert.equal(waypointPushChange(before,waypointPushProjection([] ,[]),'schedule').urgent,false);
assert.equal(waypointPushChange(before,waypointPushProjection([{...job,appointmentTime:'9 AM'}],[]),'schedule').urgent,false);
assert.equal(waypointPushChange(before,waypointPushProjection([{...job,appointmentNotes:['Edited note']}],[]),'schedule').urgent,false);
assert.ok(!JSON.stringify(before).includes('Fictional Customer'));
assert.deepEqual(waypointUpdateLabels({details:1,extra:'private',messages:2}),['Assignment details updated','2 new office messages']);
// Pure policy checks run in CI without PostgreSQL; the isolated database mode
// validates real SQL/group reservations on the deployment host.
if(process.argv.includes('--database'))void database().catch(error=>{console.error(error);process.exitCode=1;});
console.log('PASS Waypoint update policy: stable semantic projection, private counts and urgent change classification.');
async function database(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'waypoint-grouping-')),socket=path.join(root,'socket'),data=path.join(root,'db');fs.mkdirSync(socket);
 const env:NodeJS.ProcessEnv={NODE_ENV:'test',PATH:process.env.PATH,LANG:'C',LC_ALL:'C'},bin=process.env.OPSCENTER_TEST_POSTGRES_BIN||'/opt/homebrew/opt/postgresql@18/bin';
 const pg=(name:string,args:string[])=>execFileSync(path.join(bin,name),args,{env,stdio:'pipe'});let pool:Pool|undefined,started=false;
 try{
 pg('initdb',['-D',data,'--no-locale','-A','trust','-U','waypoint_test']);pg('pg_ctl',['-D',data,'-l',path.join(root,'server.log'),'-o',`-h '' -k ${socket} -p 5432`,'-w','start']);started=true;const bootstrap=new Pool({host:socket,user:'waypoint_test',database:'postgres'});try{await bootstrap.query('CREATE DATABASE waypoint_grouping_test');}finally{await bootstrap.end();}
 pool=new Pool({host:socket,user:'waypoint_test',database:'waypoint_grouping_test'});const p=pool;
 await p.query('CREATE SCHEMA opscenter_kernel');for(const file of ['0011_waypoint_push.sql','0013_waypoint_update_context.sql'])await p.query(fs.readFileSync('lib/platform/persistence/migrations/'+file,'utf8'));
 const phone:CrewPhone={deviceId:randomUUID(),truck:'Truck 4',label:'Fictional phone',enrolledAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()},device=randomUUID();
 await p.query('INSERT INTO opscenter_kernel.waypoint_push_devices(id,owner_id,phone_id,endpoint_hash,subscription_json) VALUES($1,$2,$3,$4,$5::jsonb)',[device,'fictional-owner',phone.deviceId,'fictional-hash',JSON.stringify({endpoint:'https://example.invalid/never-called'})]);
 let snapshot:CrewCurrent={state:'assigned',truck:phone.truck,job:null,jobs:[job],observedAt:new Date().toISOString()},messages:Array<{id:string}>=[];
 const source={active:()=>phone,snapshot:()=>snapshot,messages:async()=>messages},phones={active:(_id:string,truck?:string)=>!truck||truck===phone.truck?phone:null};
 let sends=0,lastEnvelope:PushEnvelope|undefined;const send=async(_endpoint:string,authorized:()=>Promise<boolean>,_deadline:number,envelope?:PushEnvelope)=>{assert.equal(await authorized(),true);lastEnvelope=envelope;sends++;return 201;};
 const count=async()=>Number((await p.query('SELECT count(*) FROM opscenter_kernel.waypoint_push_deliveries')).rows[0].count);
 await recordWaypointChanges(p,source);await recordWaypointChanges(p,source);assert.equal(await count(),0);
 snapshot={...snapshot,jobs:[{...job,appointmentNotes:[...job.appointmentNotes].reverse()}]};await recordWaypointChanges(p,source);assert.equal(await count(),0,'Cosmetic ordering does not notify');
 snapshot={...snapshot,jobs:[{...job,appointmentTime:'9 AM'}]};await recordWaypointChanges(p,source);
 snapshot={...snapshot,jobs:[{...job,appointmentTime:'10 AM'}]};await recordWaypointChanges(p,source);await recordWaypointChanges(p,source);assert.equal(await count(),2);
 await drainWaypointPush(p,()=>true,send,phones);assert.equal(sends,0,'Routine changes wait at most 15 seconds');
 messages=[{id:'fictional-message'}];await recordWaypointChanges(p,source);await drainWaypointPush(p,()=>true,send,phones);assert.equal(sends,1,'Urgent office message flushes all three updates in one notification');
 assert.equal(Number((await p.query("SELECT count(*) FROM opscenter_kernel.waypoint_push_deliveries WHERE status='accepted'")).rows[0].count),3);
 const updates=await waypointUpdates(phone,p);assert.equal(updates.length,1);assert.ok(updates.some(row=>row.counts.messages===1));assert.ok(!JSON.stringify(updates).includes('Fictional Customer'));assert.ok(!JSON.stringify(updates).includes('endpoint'));
 assert.equal(lastEnvelope?.message.path,`/crew-jobs?view=updates&update=${updates[0].id}`);assert.ok(lastEnvelope?.message.body.includes('1 new office message'));assert.ok(!JSON.stringify(lastEnvelope?.message).includes('8 AM'),'Lock screen excludes private change details');assert.equal(updates[0].changes[0].before,'8 AM');
 assert.equal((await waypointUpdates({...phone,truck:'Truck 2'},p)).length,0);assert.equal((await waypointUpdates({...phone,deviceId:randomUUID()},p)).length,0);
 await drainWaypointPush(p,()=>true,send,phones);assert.equal(sends,1,'Accepted group never replays');
 snapshot={...snapshot,jobs:[]};await recordWaypointChanges(p,source);await p.query("UPDATE opscenter_kernel.waypoint_push_deliveries SET not_before=now() WHERE status='pending'");await drainWaypointPush(p,()=>true,send,phones);assert.equal(sends,2,'Removal/cancellation is delivered after grouping');
 snapshot={...snapshot,jobs:[job]};await recordWaypointChanges(p,source);await p.query("UPDATE opscenter_kernel.waypoint_push_deliveries SET not_before=now() WHERE status='pending'");await drainWaypointPush(p,()=>true,send,phones);assert.equal(sends,3,'Returning assignment is a new meaningful event');
 snapshot={...snapshot,jobs:[{...job,appointmentTime:'11 AM'}]};await recordWaypointChanges(p,source);await p.query("UPDATE opscenter_kernel.waypoint_push_deliveries SET not_before=now() WHERE status='pending'");await drainWaypointPush(p,()=>true,send,phones);assert.equal(sends,4,'Timing change survives grouping');
 for(const time of ['12 PM','1 PM','12 PM']){snapshot={...snapshot,jobs:[{...job,appointmentTime:time}]};await recordWaypointChanges(p,source);}
 await drainWaypointPush(p,()=>true,send,phones);assert.equal(sends,4);await p.query("UPDATE opscenter_kernel.waypoint_push_deliveries SET not_before=now() WHERE status='pending'");
 let uncertainAttempts=0;await drainWaypointPush(p,()=>true,async()=>{uncertainAttempts++;throw Error('Fictional interrupted response');},phones);assert.equal(uncertainAttempts,1);
 assert.equal(Number((await p.query("SELECT count(*) FROM opscenter_kernel.waypoint_push_deliveries WHERE status='uncertain'")).rows[0].count),3);await drainWaypointPush(p,()=>true,send,phones);assert.equal(sends,4,'Uncertain grouped delivery never replays');
 const previous=await count();snapshot={...snapshot,state:'unavailable',jobs:[]};await recordWaypointChanges(p,source);assert.equal(await count(),previous,'Unavailable snapshot cannot imply removal');
 // The tapped update must survive the recent-feed limit without broadening scope.
 for(let n=0;n<35;n++)await p.query("INSERT INTO opscenter_kernel.waypoint_push_deliveries(id,device_id,phone_id,truck,service_date,status,context_json) VALUES($1,$2,$3,$4,$5,'accepted','{}')",[randomUUID(),device,phone.deviceId,phone.truck,chicagoDateKey()]);
 assert.equal((await waypointUpdates(phone,p,updates[0].id))[0].id,updates[0].id);
 assert.equal((await waypointUpdates({...phone,truck:'Truck 2'},p,updates[0].id)).length,0);
 console.log('PASS isolated PostgreSQL: grouping, dedupe, routine delay, urgent flush, cancellation/new/time events, scoped private context, accepted/uncertain no-replay, source outage. No provider call.');
 }finally{await pool?.end();if(started)pg('pg_ctl',['-D',data,'-m','immediate','-w','stop']);fs.rmSync(root,{recursive:true,force:true});}
}
