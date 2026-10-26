import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium,webkit} from 'playwright';
const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
assert.ok(fs.existsSync('public/desktop-assets/.vite/manifest.json'),'Run npm run build:desktop before this browser check; start the schedule fixture and set DISPATCH_FIXTURE_URL if it is not on port3156.');
const manifest=JSON.parse(fs.readFileSync('public/desktop-assets/.vite/manifest.json','utf8'));
const css=manifest['index.html'].css.map(file=>fs.readFileSync(`public/desktop-assets/${file}`,'utf8')).join('\n');
const output=process.env.HISTORY_SCREENSHOTS;
if(output)fs.mkdirSync(output,{recursive:true});
for(const engine of [chromium,webkit]) {
 const browser=await engine.launch({headless:true});
 try {
  for(const [width,height] of [[1920,990],[1280,900],[1024,600],[390,844]]) {
   const page=await browser.newPage({viewport:{width,height}});
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(`${base}/tests/schedule-destinations.html?scenario=fragmented-return&fullShell=1`);
   await page.locator('[data-schedule-appointment]').first().waitFor();
   await page.evaluate(()=>document.querySelectorAll('style,link[rel="stylesheet"]').forEach(e=>e.remove()));
   await page.addStyleTag({content:css});
   await page.waitForTimeout(200);
   if(width>=1000) {
    const row=page.locator('[data-schedule-truck="Truck 8"]');
    const visits=row.locator('[data-schedule-appointment]');
    assert.equal(await visits.count(),5,'Keep every GPS observation selectable');
    const geometry=await row.evaluate(row=>{
     const blocks=[...row.querySelectorAll('[data-schedule-appointment]')].map(e=>({start:Number(e.dataset.visitStart),end:Number(e.dataset.visitEnd),...e.getBoundingClientRect().toJSON()})).sort((a,b)=>a.start-b.start);
     const gap=row.querySelector('[data-visit-gap]').getBoundingClientRect();
     const line=row.querySelector('.route-connector-path polyline').getAttribute('points').split(' ').map(p=>p.split(',').map(Number));
     return {blocks,gap:gap.toJSON(),line};
    });
    if(width===1920)assert.ok(geometry.blocks.every(b=>Math.abs(b.y-geometry.blocks[0].y)<1),'Disjoint recorded observations share one chronological track when hit areas fit');
    assert.ok(geometry.blocks.every(b=>b.width>=11.9),'Every observation stays visibly selectable');
    for(let i=1;i<geometry.blocks.length;i++)assert.ok(geometry.blocks[i-1].right<=geometry.blocks[i].left+.5 || Math.abs(geometry.blocks[i-1].y-geometry.blocks[i].y)>1,'Short-card padding cannot overlap a later arrival on the same lane');
    assert.ok(geometry.gap.y>=geometry.blocks[0].bottom-.5,'Off-site annotation stays below visits');
    assert.ok(geometry.line[0][0]<geometry.line.at(-1)[0],'The travel line runs forward to the middle visit');
    assert.equal(geometry.blocks.at(-1).start,geometry.blocks.at(-1).end,'A lone observation retains zero measured duration');
    assert.match(await row.getByRole('button',{name:/Recorded visit order/}).getAttribute('title'),/Recorded visit order/);
    await visits.nth(3).click();
    await page.locator('.schedule-selected-job-pane').waitFor();
    assert.match(await page.locator('.schedule-selected-job-pane').innerText(),/Middle visit example/);
    const bounds=await page.locator('.schedule-board-scroll').evaluate(e=>({client:e.clientHeight,scroll:e.scrollHeight,rows:[...e.querySelectorAll('[data-schedule-truck]')].length}));
    assert.equal(bounds.rows,10,'The synthetic fixture must expose nine trucks plus Unassigned');assert.ok(bounds.scroll<=bounds.client+1,'All trucks stay in view');
   } else {
    assert.equal(await page.locator('.mobile-schedule-overview [data-schedule-appointment]').count(),5);
    await page.getByRole('button',{name:'Truck# 8, 2 appointments, details'}).click();
    const detail=page.locator('.mobile-schedule-detail:popover-open');await detail.waitFor();
    assert.equal(await detail.locator('.mobile-schedule-detail-job').count(),2);
    assert.match(await detail.innerText(),/departure unconfirmed/);
   }
   assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
   assert.deepEqual(errors,[]);
   if(output)await page.screenshot({path:path.join(output,`${engine.name()}-${width}.png`)});
   if(width>=1000) {
    await page.goto(`${base}/tests/schedule-destinations.html?scenario=nearby-observations&fullShell=1`);
    const close=page.locator('[data-schedule-truck="Truck 8"] [data-schedule-appointment]');await close.first().waitFor();
    await page.evaluate(()=>document.querySelectorAll('style,link[rel="stylesheet"]').forEach(e=>e.remove()));await page.addStyleTag({content:css});await page.waitForTimeout(150);
    assert.equal(await close.count(),2);
    const boxes=await Promise.all([close.nth(0).boundingBox(),close.nth(1).boundingBox()]);
    assert.ok(boxes.every(b=>b.width>=11.9),'Arrivals thirty seconds apart retain a visible minimum hit width');
    assert.ok(Math.abs(boxes[0].y-boxes[1].y)>1,'Sub-minute observations pack onto separate lanes');
    for(const index of [0,1]) {
     await close.nth(index).click();
     await page.locator('.schedule-selected-job-pane').waitFor();
     assert.match(await page.locator('.schedule-selected-job-pane').innerText(),new RegExp(`Close observation ${index+1}`),'Each tiny source observation remains independently selectable');
    }
    assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
   }
   console.log(engine.name(),width,'history chronology, identity, source uncertainty, layout and zero writes passed');
   await page.close();
  }
 } finally {await browser.close();}
}
