import assert from 'node:assert/strict';import fs from 'node:fs';import {runInNewContext} from 'node:vm';
import {truckMapHref} from '../lib/alert-destination';
import {pushPath,pushWorkspacePath,pushMessage} from '../lib/web-push-message';
async function main(){
 const contextual=truckMapHref('Truck 9','2026-10-26');
 assert.equal(pushPath(contextual),contextual,'Preserve current production truck/day destinations');
 assert.equal(pushMessage({title:'Truck alert',body:'Fixture',path:contextual})?.path,contextual);
 assert.equal(pushPath(contextual+'&next=https://evil.invalid'),undefined);
 const handlers:Record<string,(event:unknown)=>void>={};let pending:Promise<void>|undefined,opened='',navigated='',focused=0,fail=false;
 const self={location:{origin:'https://ops.fixture'},addEventListener:(name:string,fn:(event:unknown)=>void)=>{handlers[name]=fn;},clients:{matchAll:async()=>[{url:'https://ops.fixture/desktop?workspace=Command',navigate:async(url:string)=>{if(fail)throw Error('Unavailable client');navigated=url;return {focus:async()=>{focused++;}};},focus:async()=>{focused++;}}],openWindow:async(url:string)=>{opened=url;}}};
 runInNewContext(fs.readFileSync('public/opscenter-push-sw.js','utf8'),{self,URL});
 const click=async(path:string)=>{handlers.notificationclick({notification:{close:()=>{},data:{path}},waitUntil:(p:Promise<void>)=>{pending=p;}});await pending;};
 for(const [category,workspace] of [['fleet','Fleet'],['krewe','Krewe'],['schedule','Schedule']]){
  const path=pushWorkspacePath(category);assert.equal(path,'/desktop?workspace='+workspace);assert.equal(pushPath(path),path);assert.equal(pushMessage({title:'Operational change',body:'Fixture',path})?.path,path);await click(path);assert.equal(navigated,'https://ops.fixture'+path);
 }
 await click('/jobs?date=2026-10-25#job-jk123');assert.equal(navigated,'https://ops.fixture/jobs?date=2026-10-25#job-jk123');assert.equal(opened,'');assert.equal(focused,4);
 fail=true;await click('/desktop?workspace=Fleet');assert.equal(opened,'https://ops.fixture/desktop?workspace=Fleet');
 assert.equal(pushPath('/desktop?workspace=Fleet&next=https://evil.invalid'),undefined);assert.equal(pushPath('/desktop?workspace=Settings'),undefined);
 console.log('PASS OpsCenter: manager category destinations, exact job links, existing app navigation, failed-navigation recovery and fixed destination allowlist. No provider calls.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
