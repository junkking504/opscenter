import assert from 'node:assert/strict';import {runInNewContext} from 'node:vm';
import {GET} from '../app/api/crew-jobs/notifications-sw.js/route';
async function main(){const handlers:Record<string,(event:unknown)=>void>={};let notice:unknown,focused=0,opened=0,task:Promise<unknown>|undefined;
 const self={addEventListener:(name:string,fn:(event:unknown)=>void)=>handlers[name]=fn,location:{origin:'https://waypoint.fixture'},registration:{showNotification:async(title:string,options:unknown)=>{notice={title,options};}},clients:{matchAll:async()=>[{url:'https://waypoint.fixture/crew-jobs',navigate:async()=>{throw Error('uncontrolled client');},focus:async()=>{focused++;}}],openWindow:async()=>{opened++;}}};
 const response=GET();assert.equal(response.headers.get('Service-Worker-Allowed'),'/crew-jobs');assert.equal(response.headers.get('Cache-Control'),'no-store');runInNewContext(await response.text(),{self,URL});
 handlers.push({waitUntil:(value:Promise<unknown>)=>task=value,data:{json:()=>{throw Error('Must not read customer payload');}}});await task;assert.equal((notice as {title:string}).title,'Waypoint');assert.ok(!JSON.stringify(notice).includes('customer payload'));
 handlers.notificationclick({notification:{close:()=>{}},waitUntil:(value:Promise<unknown>)=>task=value});await task;assert.equal(focused,1);assert.equal(opened,0);assert.equal(handlers.fetch,undefined);console.log('PASS Waypoint SW: generic notification, no payload/cache/fetch, fixed destination and uncontrolled-client focus fallback.');}
main().catch(error=>{console.error(error);process.exitCode=1;});
