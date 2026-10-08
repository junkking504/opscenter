import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { currentOperatingDay, shiftOperatingDay } from '../desktop-ui/lib/operating-day';
async function main() {
  // Calendar days include Sunday and survive month/year and DST boundaries.
  assert.equal(shiftOperatingDay(currentOperatingDay(new Date('2026-10-05T12:00:00Z')), -1), '2026-10-04');
  assert.equal(shiftOperatingDay(currentOperatingDay(new Date('2027-01-01T12:00:00Z')), -1), '2026-12-31');
  assert.equal(shiftOperatingDay(currentOperatingDay(new Date('2026-11-02T06:30:00Z')), -1), '2026-11-01');
  const yesterday=shiftOperatingDay(currentOperatingDay(),-1), older=shiftOperatingDay(yesterday,-1);
  const result=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{LiveFinance}from'./desktop-ui/live-finance';createRoot(document.getElementById('root')).render(<LiveFinance date="2020-01-01" view="reconciliation"/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'fixture',jsx:'automatic',alias:{react:process.cwd()+'/desktop-ui/node_modules/react','react-dom':process.cwd()+'/desktop-ui/node_modules/react-dom'}});
  const js=result.outputFiles.find(f=>f.path.endsWith('.js'))!.text,css=result.outputFiles.find(f=>f.path.endsWith('.css'))!.text;
  const dates:string[]=[],ranges:string[]=[];let writes=0;
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url?.startsWith('/api/desktop/finance')) {
      const date=new URL(req.url,'http://fixture').searchParams.get('date')!;dates.push(date);
      res.end(JSON.stringify({date,available:false,generatedAt:new Date().toISOString(),daily:{revenue:null,costs:null,profit:null},reconciliation:{status:'not_collected',summary:{junkware_total:0,merchant_center_total:0,net_difference:0,exception_count:0},paymentsByJob:[],exceptions:[]}}));return;
    }
    if(req.url==='/api/desktop/accounting') {
      let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);if(body.mode!=='list')writes++;
      ranges.push(`${body.filters.from}:${body.filters.to}`);
      res.end(JSON.stringify({data:{rows:[],total:0,observedAt:new Date().toISOString(),options:{groups:[],methods:[],statuses:[]},verifications:{},pending:[]}}));return;
    }
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}
    res.setHeader('Content-Type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial;margin:12px}*{box-sizing:border-box}${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
  try {
    for(const width of [1440,390]) {
      const page=await browser.newPage({viewport:{width,height:1000}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
      await expect(page.getByLabel('Reconciliation date',{exact:true})).toHaveValue(yesterday);
      await expect(page.getByRole('heading',{name:'Reconcile the day’s payments'})).toBeVisible();
      await expect(page.getByRole('heading',{name:'Payment source unavailable'})).toBeVisible();
      const register=page.getByRole('region',{name:'JunkWare QuickBooks register'});
      await expect(register.getByLabel('From',{exact:true})).toHaveValue(yesterday);await expect(register.getByLabel('From',{exact:true})).toBeDisabled();
      await expect(page.getByLabel('Reconciliation date',{exact:true})).toBeEnabled();
      await page.getByLabel('Reconciliation date',{exact:true}).fill(older);await page.getByRole('button',{name:'Review day',exact:true}).click();
      await expect(register.getByLabel('From',{exact:true})).toHaveValue(older);
      await expect(page.getByRole('button',{name:'Yesterday',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Yesterday',exact:true}).click();
      await expect(register.getByLabel('From',{exact:true})).toHaveValue(yesterday);
      assert.ok(dates.includes(older));assert.ok(!dates.includes('2020-01-01'));assert.ok(ranges.includes(`${older}:${older}`));assert.equal(writes,0);assert.deepEqual(errors,[]);
      assert.ok(await page.locator('.capital-reconciliation-date').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      if (process.env.RECONCILIATION_SCREENSHOT_DIR) await page.screenshot({path:`${process.env.RECONCILIATION_SCREENSHOT_DIR}/reconciliation-${width}.png`,fullPage:true});await page.close();
    }
    console.log('Daily reconciliation browser passed: Central calendar day, independent date, same-day register, missing sources, date changes, desktop/mobile and no payment writes.');
  } finally {await browser.close();server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
