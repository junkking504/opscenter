import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import {writeFileSync} from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createCrewPhoneEnrollment, enrollCrewPhone, listCrewPhones, revokeCrewPhone } from '../lib/crew-phone-store';
import { readCrewDay, saveCrewDay } from '../lib/crew-phone-day';
import { crewInspectionState } from '../lib/crew-phone-inspection';
import { crewAssignedDay } from '../lib/crew-assigned-day';
import { CREW_PHONE_COOKIE } from '../lib/crew-phone';

async function main(){
  const truck=process.env.OPS_WAYPOINT_LIVE_QA_TRUCK;
  if(!truck || !process.env.OPS_CREW_PHONE_DIR)throw new Error('Explicit live QA truck and phone directory required.');
  const existing=listCrewPhones().find(phone=>phone.truck===truck && phone.state==='active' && phone.access==='live' && readCrewDay(phone) && crewInspectionState(phone).status==='ready');
  assert.ok(existing,'An existing live crew setup and real same-day inspection are required.');
  const day=readCrewDay(existing)!;
  const expected=crewAssignedDay(existing,day.date);
  assert.equal(expected.state,'assigned');
  const token=randomBytes(32).toString('hex');
  const phone=enrollCrewPhone(createCrewPhoneEnrollment(truck,'Waypoint loading QA (temporary)','waypoint-loading-qa').code,token);
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    saveCrewDay(phone,{date:day.date,requestId:randomUUID(),expectedVersion:0,truck,responsible:day.responsible,driver:day.driver,navigators:day.navigators});
    assert.equal(crewInspectionState(phone).status,'ready','Use the already-saved truck inspection; never fabricate an inspection.');
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{Cookie:`${CREW_PHONE_COOKIE}=${token}`}});
    const page=await context.newPage();
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const actionTimings:Array<{action:string;ms:number}>=[];
    const time=async(action:string,run:()=>Promise<void>)=>{const start=performance.now();await run();actionTimings.push({action,ms:Math.round(performance.now()-start)});};
    await page.route('**/api/**',route=>route.request().method()==='GET'?route.continue():route.abort('blockedbyclient'));
    const started=performance.now();
    const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/crew-jobs/current',{timeout:60_000});
    await page.goto('https://waypoint.junk-king.app/crew-jobs',{waitUntil:'domcontentloaded'});
    const response=await responsePromise;
    assert.equal(response.status(),200);
    const payload=await response.json();
    await expect(page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();
    const readyMs=Math.round(performance.now()-started);
    const currentTiming=await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>new URL(entry.name).pathname==='/api/crew-jobs/current').map(entry=>Math.round(entry.duration)));
    const apiTiming=await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>new URL(entry.name).pathname.startsWith('/api/crew-jobs/')).map(entry=>({path:new URL(entry.name).pathname,ms:Math.round(entry.duration)})));
    const localStarted=performance.now();
    const localResponse=await fetch('http://127.0.0.1:3000/api/crew-jobs/current',{headers:{Cookie:`${CREW_PHONE_COOKIE}=${token}`,'x-forwarded-proto':'https','x-forwarded-host':'waypoint.junk-king.app'}});
    await localResponse.arrayBuffer();
    const localCurrentMs=Math.round(performance.now()-localStarted);
    assert.equal(localResponse.status,200);
    if(process.argv[2]!=='before'){
      assert.deepEqual(payload.jobs.map((job:{appointmentId:string})=>job.appointmentId).sort(),expected.jobs!.map(job=>job.appointmentId).sort());
      for(const job of expected.jobs!)await expect(page.getByText(new RegExp(job.jkNumber))).toBeVisible();
      await page.getByRole('button',{name:'View assignment',exact:true}).last().click();
      await expect(page.getByRole('heading',{name:expected.jobs!.at(-1)!.customerName,exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Back to Assignments',exact:true}).click();
      for(const width of [320,390,430]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
      await page.screenshot({path:'/tmp/waypoint-truck1-live-assignments.png',fullPage:true});
      const closedIndex=payload.jobs.findIndex((job:{status:string})=>job.status==='Completed');
      if(closedIndex>=0){
        await time('Open saved closed appointment',async()=>{await page.getByRole('button',{name:'View assignment',exact:true}).nth(closedIndex).click();await expect(page.getByText('Closed out · Confirmed in JunkWare',{exact:true})).toBeVisible();});
        await expect(page.getByRole('button',{name:'Start closeout · Before photos',exact:true})).toHaveCount(0);
        await page.screenshot({path:'/tmp/waypoint-live-closed-details.png',fullPage:true});
        await page.getByRole('button',{name:'Back to Assignments',exact:true}).click();
      }
      await time('Refresh live assignments',async()=>{const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/crew-jobs/current');await page.getByRole('button',{name:'Refresh assignments',exact:true}).click();assert.equal((await response).status(),200);await expect(page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();});
      const activeIndex=payload.jobs.findIndex((job:{assignmentId?:string;status:string})=>job.assignmentId===payload.job?.assignmentId && /^confirmed$/i.test(job.status));
      if(process.argv.includes('--closeout') && activeIndex>=0){
        await time('Live assignment details',async()=>{await page.getByRole('button',{name:'View assignment',exact:true}).nth(activeIndex).click();await expect(page.getByRole('button',{name:'Start closeout · Before photos',exact:true})).toBeVisible();});
        for(let i=0;i<2;i++){
          await time(i?'Reopen saved closeout':'First closeout open (including any preparation)',async()=>{await page.getByRole('button',{name:'Start closeout · Before photos',exact:true}).click();await expect(page.getByLabel('Add before photos',{exact:true})).toBeEnabled({timeout:210_000});});
          await time('Closeout to appointment',async()=>{await page.getByRole('button',{name:'Back to appointment',exact:true}).click();await expect(page.getByRole('button',{name:'Start closeout · Before photos',exact:true})).toBeVisible();});
        }
        await page.getByRole('button',{name:'Start closeout · Before photos',exact:true}).click();await expect(page.getByLabel('Add before photos',{exact:true})).toBeEnabled();
        await time('Explicit Reload from JunkWare',async()=>{
          const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/crew-jobs/closeout' && new URL(r.url()).searchParams.get('refresh')==='1',{timeout:210_000});
          await page.getByRole('button',{name:'Reload from JunkWare',exact:true}).click();assert.equal((await response).status(),200);await expect(page.getByLabel('Add before photos',{exact:true})).toBeEnabled();
        });
        await page.screenshot({path:'/tmp/waypoint-audit-live-closeout.png',fullPage:true});
      }
    }
    assert.deepEqual(errors,[]);
    const result={truck,readyMs,currentRequestMs:currentTiming,apiTiming,localCurrentMs,actionTimings,resources:await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>new URL(entry.name).pathname.startsWith('/api/crew-jobs/')).map(entry=>({path:new URL(entry.name).pathname,ms:Math.round(entry.duration)}))),localStatus:localResponse.status,shown:(payload.jobs || [payload.job]).filter(Boolean).map((job:{jkNumber:string})=>job.jkNumber),expected:expected.jobs!.map(job=>job.jkNumber),mode:process.argv[2] || 'after',writes:'Browser GET only; temporary QA enrollment revoked on exit'};
    writeFileSync('/tmp/waypoint-live-timings.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await browser?.close();revokeCrewPhone(phone.deviceId,'waypoint-loading-qa-complete');}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
