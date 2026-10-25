import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {alertTruck,truckMapHref,notificationDestination} from '../lib/alert-destination';
import {desktopAlertHref} from '../desktop-ui/lib/desktop-links';
import {pushoverFields} from '../lib/pushover-transport';
import {pushNotificationGET} from '../lib/web-push-notification';
import {sanitizeAuthRedirectTarget} from '../lib/auth';
import {alert} from './fixtures/crew-progress';
const origin='https://ops.junk-king.app',date='2026-10-25';
const geofence=alert('geo','Geofence',date+'T15:42:00Z',{domain:'Fleet',truck:'Truck# 9',title:'Truck 9 departed NOHQ',href:'/desktop?workspace=Fleet&date='+date+'&truck=Truck%239'});
const destination=desktopAlertHref(geofence,{date},origin);
assert.equal(destination,truckMapHref('Truck 9',date));
assert.equal(sanitizeAuthRedirectTarget(destination),destination);
for(const v of ['Truck# 9','Truck 9','9','#9'])assert.equal(alertTruck(v),'Truck 9');
for(const v of ['Truck 19 extra','9e2','',0,-9, 'Truck 9 and 19'])assert.equal(alertTruck(v),null);
assert.equal(alertTruck('Truck 19'),'Truck 19');
assert.equal(notificationDestination(destination),destination);
for(const v of [destination+'&next=https://evil.invalid',destination+'&truck=19',destination.replace(date,'2026-02-30'),'//evil.invalid','/api/private','javascript:alert(1)',destination+'%0a'])assert.equal(notificationDestination(v),undefined);
const crew=desktopAlertHref({...geofence,label:'Clock Out',domain:'Krewe',truck:undefined,href:'/crew',facts:[{label:'Employee',value:'Example Driver'}]},{date},origin);
assert.equal(new URL(crew,origin).searchParams.get('member'),'Example Driver');
const unknown=desktopAlertHref({...geofence,label:'Unmapped',domain:'Other',truck:undefined,href:''},{date},origin);
assert.equal(new URL(unknown,origin).searchParams.get('alert'),'geo');
for(const href of ['/desktop?workspace=Finance&date='+date,'/finance?date='+date,'/marketing?date='+date,'/?commandView=monitor']){
 const preserved=new URL(desktopAlertHref({...geofence,label:'Dump Expense',domain:'Finance',truck:undefined,href},{date},origin),origin);
 assert.equal(preserved.searchParams.get('workspace'),href.includes('marketing')?'Marketing':href.includes('monitor')?'Command':'Finance');assert.equal(preserved.searchParams.has('alert'),false);assert.equal(preserved.searchParams.get('date'),date);
}
for(const href of ['', 'javascript:alert(1)', 'http://['])assert.equal(new URL(desktopAlertHref({...geofence,label:'Unknown',domain:'Other',truck:undefined,href},{date},origin),origin).searchParams.get('focus'),'alert');
const id='a'.repeat(64), request=new Request(origin+'/api/push/notification?id='+id);
const manager={email:'manager@example.invalid',role:'manager' as const};let reads=0;
const read=async(owner:string,event:string)=>{reads++;assert.equal(owner,manager.email);assert.equal(event,id);return {category:'fleet',occurred_at:date+'T15:42:00Z',notification_json:{title:'Truck #9',body:'Departed NOHQ',path:destination}};};
async function run(){
 assert.equal((await pushNotificationGET(request,null,read)).status,401);
 assert.equal((await pushNotificationGET(request,{...manager,role:'operator'},read)).status,403);assert.equal(reads,0);
 assert.equal((await pushNotificationGET(new Request(origin+'/api/push/notification?id=bad'),manager,read)).status,400);
 const receipt=await pushNotificationGET(request,manager,read);assert.equal(receipt.status,200);assert.match(receipt.headers.get('cache-control')!,/no-store/);assert.equal((await receipt.json()).path,destination);
 assert.equal((await pushNotificationGET(request,manager,async()=>null)).status,404);
 assert.equal((await pushNotificationGET(request,manager,async()=>{throw new Error('offline')})).status,503);
 // Actual worker, entirely local fake browser clients. No permission or provider calls.
 const handlers:Record<string,(event:any)=>void>={};let shown:any;const opened:string[]=[];let focused=0,navigated=0,closed=0;
 const self={location:{origin},addEventListener:(type:string,fn:any)=>handlers[type]=fn,registration:{showNotification:async(title:string,options:any)=>{shown={title,...options};}},clients:{matchAll:async()=>[] as any[],openWindow:async(url:string)=>{opened.push(url);}},skipWaiting:async()=>{}};
 vm.runInNewContext(fs.readFileSync('public/opscenter-push-sw.js','utf8'),{self,URL});
 let pending:Promise<unknown>=Promise.resolve();const waitUntil=(promise:Promise<unknown>)=>pending=promise;
 handlers.push({data:{json:()=>({title:'Truck #9',body:'Departed NOHQ',eventId:id,path:destination})},waitUntil});await pending;
 handlers.notificationclick({notification:{data:shown.data,close:()=>closed++},waitUntil});await pending;
 assert.equal(opened[0],origin+'/desktop?workspace=Command&notification='+id,'First tap opens private details, not the map');
 self.clients.matchAll=async()=>[{url:opened[0],navigate:async()=>navigated++,focus:()=>focused++}];
 handlers.notificationclick({notification:{data:shown.data,close:()=>closed++},waitUntil});await pending;
 self.clients.matchAll=async()=>[{url:opened[0],navigate:async()=>{throw new Error('uncontrolled');},focus:()=>focused++}];
 handlers.notificationclick({notification:{data:shown.data,close:()=>closed++},waitUntil});await pending;
 assert.equal(focused,2);assert.equal(closed,3);
 const fields=pushoverFields({token:'t',user:'u',device:'d'} as any,{message:{title:'Truck #9',body:'Departed NOHQ',path:destination}} as any,60);assert.equal(fields.get('url'),origin+'/desktop','Pushover retains its prior generic destination');
 assert.equal(navigated,1);
 console.log('PASS contextual destinations, exact identity, login retention, receipt authorization and native cold/repeated clicks. No external sends.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
