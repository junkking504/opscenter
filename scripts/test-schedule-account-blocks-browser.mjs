import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,webkit} from 'playwright';
const out=process.env.SCHEDULE_SCREENSHOT_DIR||'/tmp/truck9-block-evidence';fs.mkdirSync(out,{recursive:true});
const baseline=process.env.BASELINE==='1';
const repo=process.cwd();
const manifest=JSON.parse(fs.readFileSync(`${repo}/public/desktop-assets/.vite/manifest.json`,'utf8'));
const compiledCss=manifest['index.html'].css.map(file=>fs.readFileSync(`${repo}/public/desktop-assets/${file}`,'utf8')).join('\n');
const job=(id,truck,start,end,extra={})=>({recordId:`2026-09-07:appointment:${id}`,appointmentId:String(id),jkNumber:`JK${id}`,version:'a'.repeat(64),callAhead:'not_called',truck,status:'Confirmed',appointmentType:'Job',customerName:`Example ${id}`,address:'100 Example St, New Orleans, LA 70118',phone:'',customerEmail:'',appointmentUrl:'',territory:'New Orleans',hasScheduledTime:true,appointmentTime:'Source booked window',appointmentStartMinutes:start,appointmentEndMinutes:end,driver:'',navigator:'',paymentType:'',paymentAmount:0,tipAmount:0,junkItems:[],pickupItems:[],appointmentNotes:[],cancellationReason:'',location:null,...extra});
const fixtures={
 clear:{appointments:[job(1001,'Truck 9',540,600,{status:'Completed',truckVisits:[{truck:'Truck 9',arrival:'2026-09-07T14:00:00Z',departure:'2026-09-07T14:04:00Z',observedThrough:'2026-09-07T14:04:00Z'}]}),job(1002,'Truck 9',600,660,{address:'Amazon Mattress Removal 100 Example St, New Orleans, LA 70118'}),job(1003,'Truck 9',720,780,{appointmentNotes:['Call NA at +1 (855) 888-0112 for approval.']}),job(1004,'Truck 8',480,540),job(1005,'Truck 8',480,540),...Array.from({length:7},(_,i)=>job(1010+i,'Unassigned',840,900))],operationalStops:[{id:'hq',truck:'Truck 9',kind:'hq',name:'HQ',label:'HQ',startMinutes:420,endMinutes:430,ongoing:false}],legs:[]},
 overlap:{appointments:[job(1001,'Truck 9',540,600),job(1002,'Truck 9',570,630),job(1003,'Truck 9',720,780)],operationalStops:[],legs:[]},
};
fixtures.recordedOverlap={appointments:[job(1001,'Truck 9',540,600,{status:'Completed',truckVisits:[{truck:'Truck 9',arrival:'2026-09-07T14:00:00Z',departure:'2026-09-07T14:25:00Z',observedThrough:'2026-09-07T14:25:00Z'}]}),job(1002,'Truck 9',540,600,{status:'Completed',truckVisits:[{truck:'Truck 9',arrival:'2026-09-07T14:10:00Z',departure:'2026-09-07T14:35:00Z',observedThrough:'2026-09-07T14:35:00Z'}]}),job(1003,'Truck 9',720,780)],operationalStops:[],legs:[]};
const reports=[];
for(const [name,engine] of (baseline?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]])){
 const browser=await engine.launch({headless:true});try{
 for(const [w,h] of (baseline?[[390,844]]:[[320,650],[390,844],[430,932],[844,390]]))for(const theme of (baseline?['light']:['light','dark']))for(const [scenario,fixture] of Object.entries(fixtures)){
  const page=await browser.newPage({viewport:{width:w,height:h},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.addInitScript(({fixture,theme})=>{window.scheduleFixture=fixture;localStorage.setItem('opscenter.theme.v1',theme);},{fixture,theme});
  await page.goto(`${process.env.DISPATCH_FIXTURE_URL||'http://127.0.0.1:3172'}/tests/schedule-destinations.html?scenario=truck9`);
  await page.locator('.mobile-schedule-overview').waitFor();
  if(!baseline){await page.evaluate(()=>{document.querySelectorAll('style,link[rel="stylesheet"]').forEach(n=>n.remove());const main=document.querySelector('main');main.classList.add('ops-app');main.dataset.cssPhaseTwo='Schedule';main.style.display='block';});await page.addStyleTag({content:compiledCss});}
  await page.waitForTimeout(200);
  await page.evaluate(theme=>document.documentElement.dataset.opsTheme=theme,theme);
  const row=page.locator('[data-overview-truck="Truck 9"]');
  const metrics=await row.evaluate(r=>{const rb=r.getBoundingClientRect(),track=r.querySelector('.mobile-schedule-track').getBoundingClientRect();return{rowHeight:rb.height,trackWidth:track.width,blocks:[...r.querySelectorAll('.mobile-schedule-visit')].map(n=>{const b=n.getBoundingClientRect();return{id:n.dataset.scheduleAppointment,x:b.x-track.x,y:b.y-rb.y,width:b.width,height:b.height,start:n.dataset.visitStart,end:n.dataset.visitEnd,basis:n.dataset.timeBasis,label:n.getAttribute('aria-label')};})};});
  reports.push({name,w,h,theme,scenario,...metrics});
  const blocks=metrics.blocks;assert.equal(blocks.length,3);assert.deepEqual(errors,[]);
  for(let i=0;i<blocks.length;i++)for(let j=i+1;j<blocks.length;j++){const a=blocks[i],b=blocks[j];assert.ok(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)<=.5||Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)<=.5,'Blocks never visually collide');}
  if(!baseline){assert.ok(blocks.every(b=>b.height===28),JSON.stringify(metrics));assert.equal(scenario==='clear'?blocks[0].y===blocks[1].y:blocks[0].y!==blocks[1].y,true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(scenario==='clear'){assert.equal(blocks[0].start,'540');assert.equal(blocks[0].end,'544');assert.equal(blocks[0].basis,'actual');assert.equal(await row.locator('.schedule-account-asterisk').count(),2);assert.match(blocks[1].label,/Amazon/);assert.match(blocks[2].label,/National account/);assert.match(await page.locator('.mobile-schedule-legend').innerText(),/Amazon \/ national account/);}
  }
  if(!baseline&&scenario==='clear'){
   for(const [index,label] of [[1,'Amazon'],[2,'National account']]){
   const card=row.locator('[data-schedule-appointment]').nth(index);
   await card.tap();const summary=page.locator('.appointment-summary-dialog');await summary.waitFor();assert.equal(await summary.getByRole('img',{name:label,exact:true}).count(),1);assert.equal(await page.locator('.job-record-drawer').count(),0,'Tap retains compact summary-first behavior');
   await summary.getByRole('button',{name:'Close appointment summary'}).click();await summary.waitFor({state:'hidden'});
   }
  }
  assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  await page.locator('.schedule-board-shell').screenshot({path:`${out}/${baseline?'before':'after'}-${name}-${w}x${h}-${theme}-${scenario}.png`});
  await page.close();
 }
 }finally{await browser.close();}
}
fs.writeFileSync(`${out}/${baseline?'before':'after'}-metrics.json`,JSON.stringify(reports,null,2));console.log(`${reports.length} rendered cases passed; no operational writes.`);
