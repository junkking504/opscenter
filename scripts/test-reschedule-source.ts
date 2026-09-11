import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import {rescheduleOnPage} from './reschedule-junkware-appointment';
async function main(){
  let saved={date:'9/11/2026',start:480,status:'Confirmed'},saves=0,mode='';
  const clock=(start:number)=>String(Math.floor(start/60)%12||12)+':00 '+(start>=720?'PM':'AM');
  const html=(state= saved)=>'<form method="post"><input type="hidden" name="__EVENTTARGET"><input type="hidden" name="__EVENTARGUMENT">'+
    '<input name="date" id="ctl00_Content_AppointmentDateTB" value="'+state.date+'">'+
    '<input id="ctl00_Content_StartTimeTB" value="'+clock(state.start)+'">'+
    '<div>Assigned: Truck# 8<select id="ctl00_Content_TruckDD"><option>Truck# 8</option></select></div>'+
    '<select id="ctl00_Content_DurationDD"><option value="2">2</option></select>'+
    '<select name="status" id="ctl00_Content_StatusDD">'+['Confirmed','Completed','Cancelled'].map((label,i)=>'<option value="'+[1,8,9][i]+'" '+(state.status===label?'selected':'')+'>'+label+'</option>').join('')+'</select>'+
    '<select name="time" id="ctl00_Content_AvailableTimesDD">'+[480,...(mode==='unavailable'?[]:[600])].map(start=>'<option value="'+String(start/60).padStart(2,'0')+':00" '+(start===state.start?'selected':'')+'>'+clock(start)+'</option>').join('')+'</select>'+
    '<input id="ctl00_Content_EmailTB" value="test@example.com">'+
    '<input id="ctl00_Content_SaveAppointmentBtn" name="save" type="submit" value="Save"></form>';
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const fields=new URLSearchParams(body);
    let state=saved;
    if(req.method==='POST'){
      state={date:fields.get('date')!,start:Number(fields.get('time')?.split(':')[0])*60,status:({'1':'Confirmed','8':'Completed','9':'Cancelled'} as Record<string,string>)[fields.get('status')!]};
      if(fields.has('save')){saves++;if(!mode.endsWith('mismatch'))saved=state;if(mode.endsWith('lost')){res.writeHead(500);res.end('Lost response after save');return;}}
    }
    res.setHeader('Content-Type','text/html');res.end(html(state));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+(server.address() as {port:number}).port+'/appointment.aspx';
  const browser=await chromium.launch({headless:true});
  try{
    for(const test of ['date-only','date-time','time-only','unavailable','conflict','closed','lost','mismatch','restore','restore-same','restore-lost','restore-mismatch','restore-noncanceled']){
      mode=test;saved={date:'9/11/2026',start:480,status:'Confirmed'};saves=0; saved.status=test==='closed'?'Completed':test.startsWith('restore') && test!=='restore-noncanceled'?'Cancelled':'Confirmed';
      const page=await browser.newPage();
      await page.goto(url);
      const input={appointmentId:'1234',restore:test.startsWith('restore'),date:(test==='time-only' || test==='restore-same')?'2026-09-11':'2026-09-15',appointmentStartMinutes:(test==='date-only' || test==='restore-same')?480:600,expectedDate:test==='conflict'?'2026-09-10':'2026-09-11',expectedAppointmentStartMinutes:480,expectedEndMinutes:600,expectedTruck:'Truck 8'};
      const result=await rescheduleOnPage(page,input,async()=>{await page.goto(url);});
      if(['unavailable','conflict','closed','restore-noncanceled'].includes(test)){assert.equal(result.ok,false,test);assert.equal(result.submitted,false,test);assert.equal(saves,0,test);}
      else {assert.equal(saves,1,test);if(test.startsWith('restore') && !test.endsWith('mismatch'))assert.equal(saved.status,'Confirmed');assert.equal(result.ok,!test.endsWith('mismatch'),test);}
      await page.close();
    }
    console.log('Source browser fixture passed: date-only, date/time, same-day, unavailable slot, source conflict, closed, lost-save read-back and mismatched saved result; no live source writes.');
  }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
void main();
