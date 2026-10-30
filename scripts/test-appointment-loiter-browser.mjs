import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from '../desktop-ui/node_modules/vite/dist/node/index.js';
import {chromium} from '@playwright/test';
import {scheduleVisitState} from '../lib/desktop-schedule-visits.ts';
import {currentGpsJobLocation} from '../lib/schedule-gps-presence.ts';
import {scheduleTruckVisits} from '../lib/schedule-visit-intervals.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'loiter-browser-'));
const server=await createServer({configFile:path.join(root,'desktop-ui/tests/schedule-destinations.vite.config.ts'),configLoader:'runner',cacheDir:cache,base:'/',server:{host:'127.0.0.1',port:0,strictPort:false}});
const date='2026-09-08',now=Date.parse(date+'T17:00:00Z');
const job={recordId:date+':appointment:101',version:'fixture',appointmentId:'101',jkNumber:'JK1000101',truck:'Truck 8',status:'Confirmed',appointmentType:'Job',appointmentStartMinutes:900,appointmentEndMinutes:960,appointmentTime:'3:00 PM–4:00 PM',hasScheduledTime:true,customerName:'Synthetic afternoon appointment',address:'100 Example Street, New Orleans, LA 70115',customerEmail:'',phone:'',territory:'New Orleans',sourceTerritory:'New Orleans',appointmentUrl:'',location:{latitude:30,longitude:-90},driver:'Fixture crew',navigator:'',additionalCrew:[],paymentType:'',paymentAmount:0,tipAmount:0,junkItems:[],pickupItems:[],appointmentNotes:[],cancellationReason:'',callAhead:'not_called'};
const raw=[{appointment_id:'101',jk_number:job.jkNumber,truck_number:'Truck 8',match_confidence:'confirmed',visit_count:1,visit_intervals:[{arrival:date+'T14:28:04Z',departure:date+'T14:29:05Z',source_timestamps:[date+'T14:28:04Z',date+'T14:29:05Z']}]}];
const projected={...job,...scheduleVisitState(job,raw,new Date(now).toISOString(),[],now),truckVisits:scheduleTruckVisits(job,raw,[],[job],now)};
let browser;
try {
 await server.listen();browser=await chromium.launch({headless:true});
 for(const width of [390,1440]) for(const scenario of ['pass','parked']) {
  const parkedTruck={truck:'Truck 2',...job.location,speed:0,ignition:'OFF',lastGpsUpdate:new Date(now-20*60_000).toISOString(),routePoints:[]};
  const location=currentGpsJobLocation(job,[parkedTruck],[job],now);
  const shown=scenario==='parked'?{...projected,truckAtJob:true,atJobTruck:location.truck,atJobGpsAt:location.observedAt}:projected;
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(snapshot=>{window.scheduleFixture=snapshot;},{appointments:[shown],operationalStops:[],legs:[],truckLoads:[]});
  const url=`http://127.0.0.1:${server.httpServer.address().port}/tests/schedule-destinations.html?scenario=loiter&fullShell=1&clock=${new Date(now).toISOString()}`;
  await page.goto(url);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'public/desktop-assets/.vite/manifest.json'),'utf8'));
  const css=manifest['index.html'].css.map(file=>fs.readFileSync(path.join(root,'public/desktop-assets',file),'utf8')).join('\n');
  await page.addStyleTag({content:css});
  const block=page.locator('[data-schedule-appointment="'+job.recordId+'"]');await block.first().waitFor();
  assert.equal(await block.first().getAttribute('data-time-basis'),'booked');
  assert.equal(await block.first().getAttribute('data-visit-start'),'900');
  assert.equal(await block.first().getAttribute('data-visit-end'),'960');
  assert.match(await block.first().getAttribute('aria-label'),scenario==='parked'?/At job · parked GPS/:/Confirmed/);
  assert.equal(await page.locator('[data-time-basis="actual"]').count(),0);
  await block.first().click();
  if(scenario==='parked') {
   await page.getByText(/Parked report/).first().waitFor();
   assert.equal(await page.getByText('GPS visit unconfirmed',{exact:true}).count(),0);
   const summary=page.locator(width<700?'.appointment-summary-dialog':'.selected-job-closest');
   assert.match(await summary.innerText(),/Truck#? 2/);
   assert.match(await summary.innerText(),/11:40 AM/);
   assert.match(await summary.innerText(),/Arrival time and duration unconfirmed/);
  } else await page.getByText('GPS visit unconfirmed',{exact:true}).waitFor();
  assert.equal(await page.locator('#fixture-writes').textContent(),'Writes: 0');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const output=process.env.LOITER_SCREENSHOTS;if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,`loiter-${scenario}-${width}.png`),fullPage:true});}
  await page.reload();await block.first().waitFor();assert.equal(await block.first().getAttribute('data-visit-start'),'900');
  assert.deepEqual(errors,[]);console.log(`PASS ${scenario} ${width}x950: planned 15–16, truthful location/visit status, no actual block, zero writes, retained after reload; ${url}`);
  await page.close();
 }
}finally{await browser?.close();await server.close();fs.rmSync(cache,{recursive:true,force:true});}
