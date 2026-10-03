import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
async function main() {
  const tx = {id:'201',type:'SalesReceipt',date:'2026-09-01',amount:125,cardLastFour:'0026',customer:'',status:'posted'};
  const card = {date:tx.date,appointmentId:'101',jkNumber:'JK101',customer:'Fixture Customer',paymentMethod:'Credit Card x0026',cardLastFour:'0026',tender:'card',paidAmount:100,revenueAmount:100,tipAmount:0,qboTransactionId:null,qboStatus:null,reconciliation:'Missing in QBO'};
  const data = {reconciliation:{status:'needs_review',merchantCenterAvailable:true,merchantCenterFresh:true,merchantCenterCollectedAt:'2026-09-02T12:00:00Z',generatedAt:'2026-09-02T12:00:00Z',summary:{junkware_total:100,merchant_center_total:125,net_difference:25,exception_count:2},recordedPayments:{total:300,cash:200,check:0},paymentsByJob:[card,{...card,jkNumber:'JK102',customer:'Cash Fixture',appointmentId:'102',paymentMethod:'Cash',tender:'cash',paidAmount:200,revenueAmount:200}],exceptions:[{date:tx.date,type:'Missing in QBO',reference:'JK101',customer:card.customer,cardLastFour:'0026',junkwareAmount:100,merchantAmount:null,appointmentId:'101'},{date:tx.date,type:'QBO only',reference:'201',customer:'—',cardLastFour:'0026',junkwareAmount:null,merchantAmount:125,qboTransactions:[tx]}]}};
  const result = await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{CapitalPayments}from'./desktop-ui/capital-payments';import './desktop-ui/capital-workspace.css';createRoot(document.getElementById('root')).render(<CapitalPayments data={${JSON.stringify(data)}} date="2026-09-01" onReview={()=>{document.body.dataset.review='opened'}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'fixture',jsx:'automatic',alias:{react:process.cwd()+'/desktop-ui/node_modules/react','react-dom':process.cwd()+'/desktop-ui/node_modules/react-dom'}});
  const js=result.outputFiles.find(f=>f.path.endsWith('.js'))!.text,css=result.outputFiles.find(f=>f.path.endsWith('.css'))!.text;
  let writes=0;
  const server=createServer(async(req,res)=>{
    if(req.url==='/api/desktop/accounting') {let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);if(body.mode!=='list')writes++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:{rows:[],total:0,observedAt:'2026-09-02T12:00:00Z',options:{groups:[],methods:[],statuses:[]},verifications:{},pending:[]}}));return;}
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}
    res.setHeader('Content-Type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial;margin:12px}*{box-sizing:border-box}${css}</style></head><body><div class="capital-workspace" id="root"></div><script src="/app.js"></script></body></html>`);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try {
    for(const width of [1440,390]) {
      const page=await browser.newPage({viewport:{width,height:1000}});const errors:string[]=[];page.on('pageerror',err=>errors.push(err.message));
      await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
      const panel=page.getByRole('region',{name:'Cross-check payments',exact:true});
      await expect(panel).toContainText('3 records to review');
      await page.getByRole('button',{name:/Unverified cards.*Review/}).click();
      const list=panel.getByRole('navigation',{name:'Inconsistent transactions'});
      await expect(list.getByRole('button')).toHaveCount(1);
      await expect(panel).toContainText('Not a confirmed match.');await expect(panel).toContainText('Amount difference: $25.00');
      await expect(panel.getByRole('link',{name:'Open JunkWare job',exact:true})).toHaveAttribute('href','https://junkware.junk-king.com/franchise/appointment.aspx?id=101');
      await expect(panel.getByRole('link',{name:'Open QuickBooks transaction 201'})).toHaveAttribute('href','https://qbo.intuit.com/app/salesreceipt?txnId=201');
      await panel.getByRole('button',{name:'Accounting · 2',exact:true}).click();
      await list.getByRole('button',{name:/Unmatched QuickBooks transaction/}).click();
      await expect(panel.getByRole('article')).toContainText('No matched JunkWare payment');
      await panel.getByRole('button',{name:'Compare payment JK101',exact:true}).click();await expect(panel.getByRole('article')).toContainText('Fixture Customer · JK101');
      await page.getByRole('button',{name:/Cash & checks.*Review/}).click();await expect(list.getByRole('button')).toHaveCount(1);await expect(panel).toContainText('Cash Fixture');
      await panel.getByRole('button',{name:'Review payment evidence',exact:true}).click();assert.equal(await page.locator('body').getAttribute('data-review'),'opened');
      await panel.getByRole('button',{name:'Processor · 0',exact:true}).click();await expect(panel).toContainText('No records in this category');
      await panel.getByRole('button',{name:'All inconsistencies · 3',exact:true}).click();
      assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'cross-check panel fits viewport');
      assert.deepEqual(errors,[]);assert.equal(writes,0,'review and navigation make no accounting writes');await page.close();
    }
    console.log('Cross-check browser passed: desktop/mobile summary shortcuts, filtering, source links, unmatched QBO selection, evidence review and zero financial writes.');
  } finally {await browser.close();server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
