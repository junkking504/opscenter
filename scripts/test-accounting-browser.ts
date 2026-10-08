import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
async function main() {
 const result = await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{CapitalAccounting}from'./desktop-ui/capital-accounting';createRoot(document.getElementById('root')).render(<CapitalAccounting date="2026-10-02" onVerifications={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'fixture',jsx:'automatic',alias:{react:process.cwd()+'/desktop-ui/node_modules/react','react-dom':process.cwd()+'/desktop-ui/node_modules/react-dom'}});
 const js=result.outputFiles.find(f=>f.path.endsWith('.js'))!.text,css=result.outputFiles.find(f=>f.path.endsWith('.css'))!.text;
 const base={key:'fixture-check',appointmentId:'123',jkNumber:'JK123',date:'2026-10-02',amount:800,method:'Check #1167',customer:'Fixture Customer',billingEmail:'',email:'fixture@example.invalid',crew:'Fixture Crew',syncStatus:'U'};
 const billed={...base,key:'fixture-billed',appointmentId:'124',jkNumber:'JK124',amount:634,method:'Billed'};
 let writes=0,recoveries=0,uncertain=false;
 const server=createServer(async(req,res)=>{
  if(req.url==='/api/desktop/accounting') { let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);res.setHeader('Content-Type','application/json');
   if(body.mode==='list') {res.end(JSON.stringify({data:{rows:body.filters.status==='S'?[]:[base,billed],total:body.filters.status==='S'?0:1434,observedAt:new Date().toISOString(),options:{groups:[{value:'A',label:'All'},{value:'399',label:'Fixture franchise'}],methods:[],statuses:[]},verifications:{},pending:[]}}));return;}
   if(body.mode==='action') {writes++;assert.ok(['verify','receive'].includes(body.action));assert.equal(body.rows.length,1);assert.equal(body.rows[0].appointmentId,'123');if(uncertain){res.writeHead(502);res.end('{"error":"Response interrupted"}');return;}res.end(JSON.stringify({data:{id:body.requestId,action:body.action,complete:true,items:[{row:base,state:'verified',message:body.action==='receive'?'Manager confirmed cash/check received. QuickBooks sync unchanged.':'JunkWare confirms this record is synced to QuickBooks.'}]}}));return;}
   recoveries++;res.end(JSON.stringify({data:{id:body.requestId,action:'verify',complete:true,items:[{row:base,state:'verified',message:'Saved result verified without replay.'}]}}));return;
  }
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}
  res.setHeader('Content-Type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial;margin:12px}*{box-sizing:border-box}.capital-table-scroll{overflow:auto}.capital-table{border-collapse:collapse}.capital-table td,.capital-table th{padding:10px;border-bottom:1px solid #ddd}.capital-table small,.capital-table a{display:block}.capital-toolbar{padding:12px}.capital-button{padding:8px;border:1px solid #ccc;border-radius:5px}${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const browser=await chromium.launch({headless:true});
 try {
  for(const width of [1440,390]) {
   const page=await browser.newPage({viewport:{width,height:1000}});await page.goto(url);
   await expect(page.getByText('2 of 2 records')).toBeVisible();await expect(page.getByText('Billed · receivable')).toBeVisible();
   await page.getByLabel('Select JK123',{exact:true}).check();await page.getByRole('button',{name:'Verify & update QuickBooks',exact:true}).click();
   await expect(page.getByRole('region',{name:'Review accounting action'})).toContainText('Check #1167');const before=writes;
   await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(writes,before,'Review or cancel must not submit');
   await page.getByRole('button',{name:'Verify & update QuickBooks',exact:true}).click();await page.getByRole('button',{name:'Confirm verification & update',exact:true}).click();
   await expect(page.getByText('Source update confirmed',{exact:true})).toBeVisible();assert.equal(writes,before+1);
   await page.getByLabel('Select JK123',{exact:true}).check();await page.getByRole('button',{name:'Verify cash & checks received',exact:true}).click();
   await expect(page.getByRole('region',{name:'Review accounting action'})).toContainText('mailbox envelopes');await expect(page.getByRole('region',{name:'Review accounting action'})).toContainText('does not update QuickBooks');
   await page.getByRole('button',{name:'Confirm cash/check receipt',exact:true}).click();await expect(page.getByText('Cash/check receipt recorded',{exact:true})).toBeVisible();assert.equal(writes,before+2);
   await page.getByLabel('Select JK124',{exact:true}).check();await expect(page.getByRole('button',{name:'Verify cash & checks received',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Verify & update QuickBooks',exact:true})).toBeDisabled();
   await page.getByLabel('JunkWare sync status').selectOption('S');await expect(page.getByLabel('Select JK124',{exact:true})).toHaveCount(0);
   await page.getByRole('button',{name:'Refresh register',exact:true}).click();await expect(page.getByText('No records match these source filters.')).toBeVisible();await page.close();
  }
  const page=await browser.newPage();await page.goto(url);uncertain=true;await page.getByLabel('Select JK123',{exact:true}).check();await page.getByRole('button',{name:'Verify & update QuickBooks',exact:true}).click();await page.getByRole('button',{name:'Confirm verification & update',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Response interrupted');const before=writes;
  await page.reload();await page.getByRole('button',{name:'Check saved result',exact:true}).click();await expect(page.getByText('Saved result verified without replay.')).toBeVisible();assert.equal(writes,before);assert.equal(recoveries,1);await page.close();
  console.log('Accounting browser passed: desktop/mobile selection, billed rows, review/cancel, single confirm, stale-filter clearing, reload recovery without replay.');
 } finally {await browser.close();server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
