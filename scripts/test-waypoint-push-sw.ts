import assert from 'node:assert/strict';import {runInNewContext} from 'node:vm';
import {GET} from '../app/api/crew-jobs/notifications-sw.js/route';
import {waypointEntryTarget} from '../lib/waypoint-entry';
async function main(){
 const handlers:Record<string,(event:unknown)=>void>={};let notice:{title:string;options:{body:string;data:{path:string}}}|undefined,focused=0,opened='',navigated='',fail=false,task:Promise<unknown>|undefined;
 const id='12345678-1234-4234-8234-123456789012',path='/crew-jobs?view=updates&update='+id;
 const self={addEventListener:(name:string,fn:(event:unknown)=>void)=>handlers[name]=fn,location:{origin:'https://waypoint.fixture'},registration:{showNotification:async(title:string,options:NonNullable<typeof notice>['options'])=>{notice={title,options};}},clients:{matchAll:async()=>[{url:'https://waypoint.fixture/crew-jobs',navigate:async(url:string)=>{navigated=url;if(fail)throw Error('uncontrolled client');return {focus:async()=>{focused++;}};}}],openWindow:async(url:string)=>{opened=url;}}};
 const response=GET();assert.equal(response.headers.get('Service-Worker-Allowed'),'/crew-jobs');assert.equal(response.headers.get('Cache-Control'),'no-store');runInNewContext(await response.text(),{self,URL});
 const push=async(data:unknown)=>{handlers.push({waitUntil:(value:Promise<unknown>)=>task=value,data:{json:()=>data}});await task;};
 const click=async(value:unknown)=>{handlers.notificationclick({notification:{close:()=>{},data:{path:value}},waitUntil:(value:Promise<unknown>)=>task=value});await task;};
 await push({title:'Waypoint · Truck 4',body:'1 appointment added. Tap to review.',path});assert.equal(notice?.options.body,'1 appointment added. Tap to review.');assert.equal(notice?.options.data.path,path);
 await click(path);assert.equal(navigated,'https://waypoint.fixture'+path);assert.equal(focused,1);assert.equal(opened,'');
 fail=true;await click(path);assert.equal(opened,'https://waypoint.fixture'+path,'Navigation failure opens the actual requested update, not an unrelated existing screen');
 assert.equal(waypointEntryTarget(path),path,'Sign-in retains exact update');
 for(const invalid of ['https://evil.invalid','//evil.invalid','/api/private',path+'&next=evil',path+'\n']){await click(invalid);assert.equal(opened,'https://waypoint.fixture/crew-jobs?view=updates');assert.equal(waypointEntryTarget(invalid),'/crew-jobs');}
 await push(null);assert.equal(notice?.title,'Waypoint');assert.equal(handlers.fetch,undefined);
 console.log('PASS Waypoint notification context, exact update destination, failed-navigation recovery, sign-in preservation and unsafe destination denial. No provider calls.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
