import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import {moveOnDailySchedule,readSavedDispatchTruck,type DispatchSource} from './junkware-dispatch-move';
async function main(){
 let state:DispatchSource, posts=0, mode='', posted:Record<string,unknown>={},group='wrong',filterPosts=0;
 const server=createServer(async(req,res)=>{
  if(req.method==='POST' && req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
   let body='';for await(const chunk of req)body+=chunk;
   group=new URLSearchParams(body).getAll('groups').join(',');filterPosts++;
  } else if(req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;posted=JSON.parse(body);posts++;
   if(mode!=='mismatch')state={...state,truck:posted.truckId==='395'?'Truck 3':'',start:Number(String(posted.startTime).split(':')[0])*60};
   if(mode==='payment-change')state.protectedCloseout={payments:[]};
   if(mode==='status-change')state.status='Confirmed';
   res.writeHead(mode==='lost'?500:200,{'Content-Type':'application/json'});res.end('{}');return;
  }
  const cross=['cross-franchise','missing-lane','ambiguous-lane'].includes(mode);
  const filter=mode==='filtered'||cross?`<form method="post"><input name="__EVENTTARGET"><select id="ctl00_Content_ServiceProviderGroupLB" name="groups" multiple><option value="wrong" ${group.includes('wrong')?'selected':''}>Wrong view</option><option value="nola" ${group.includes('nola')?'selected':''}>New Orleans</option><option value="jp" ${group.includes('jp')?'selected':''}>Jefferson Parish</option></select><input type="submit" id="ctl00_Content_SelectServiceProvidersBtn" name="apply" style="display:none"></form>`:'';
  const destination=!cross || mode!=='missing-lane' && group.includes('jp');
  const headers=`<th>Hours</th><th>Truck# 1<input class="truck-id" value="351"></th>${destination?'<th>Truck# 3<input class="truck-id" value="395"></th>':''}${mode==='ambiguous-lane'&&destination?'<th>Truck# 3<input class="truck-id" value="999"></th>':''}<th>Virtual Truck<input class="truck-id" value="399"></th>`;
  const shown=mode==='filtered'?group.includes('nola'):cross?group.includes('nola'):true;
  const appointment=shown?'<div id="aid-1234" class="'+(mode==='not-draggable'?'':'draggable')+'">Completed appointment</div>':'';
  res.setHeader('Content-Type','text/html');res.end(filter+'<input id="UserIDHF" value="100"><table class="schedule-table"><tr>'+headers+'</tr><tr><td>8 AM</td><td>'+appointment+'</td></tr></table>');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+(server.address() as {port:number}).port;
 const browser=await chromium.launch({headless:true});
 try{
  const readPage=await browser.newPage();
  for(const [status,label,selected,expected] of [
   ['Completed','','Truck# 3','Truck 3'],
   ['Completed','','',''],
   ['Confirmed','Assigned: Truck# 1','Truck# 3','Truck 1'],
   ['Confirmed','','Truck# 3',''],
  ]){
   await readPage.setContent(`<select id="ctl00_Content_StatusDD"><option>${status}</option></select><div><select id="ctl00_Content_TruckDD"><option>${selected}</option></select>${label}</div>`);
   assert.equal(await readSavedDispatchTruck(readPage),expected,`${status}: ${label || 'no assignment label'}`);
  }
  await readPage.close();
  for(const test of ['completed','confirmed','filtered','cross-franchise','missing-lane','ambiguous-lane','lost','mismatch','payment-change','status-change','canceled','wrong-date','duration-change','not-draggable','unassigned']){
   mode=test;posts=0;group=['cross-franchise','missing-lane','ambiguous-lane'].includes(test)?'nola':'wrong';filterPosts=0;
   state={appointmentId:'1234',date:'2026-09-11',truck:'Truck 1',start:780,duration:1,status:test==='canceled'?'Canceled':test==='confirmed'?'Confirmed':'Completed',protectedCloseout:{payments:[{method:'Check',amount:'388.00',reference:'00123'}],total:'388.00',status:test}};
   const page=await browser.newPage();await page.goto(url);
   const run=()=>moveOnDailySchedule(page,{appointmentId:'1234',truck:test==='unassigned'?'':'Truck 3',start:660,duration:test==='duration-change'?2:1,expectedDate:test==='wrong-date'?'2026-09-10':'2026-09-11'},async()=>structuredClone(state),async()=>{await page.goto(url);},async()=>{await page.goto(url);});
   if(['mismatch','payment-change','status-change','canceled','wrong-date','duration-change','not-draggable','missing-lane','ambiguous-lane'].includes(test))await assert.rejects(run,test);
   else {const result=await run();assert.equal(result.after.start,660);assert.equal(result.after.status,test==='confirmed'?'Confirmed':'Completed');assert.deepEqual(result.after.protectedCloseout,result.before.protectedCloseout);assert.equal(posted.startTime,'11:00');}
   assert.equal(posts,['canceled','wrong-date','duration-change','not-draggable','missing-lane','ambiguous-lane'].includes(test)?0:1,test);
   if(test==='filtered') {assert.equal(group,'nola');assert.equal(filterPosts,2,'Search the schedule group filter before submitting the single move');}
   if(test==='cross-franchise') {assert.ok(group.includes('nola')&&group.includes('jp'));assert.equal(filterPosts,1,'Expose both franchises before one move');}
   await page.close();
  }
  console.log('Dispatch source fixture passed: completed and open jobs, past-hour move, virtual truck, status/payment preservation, one submit after lost response and invalid-source guards.');
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
}
void main();
