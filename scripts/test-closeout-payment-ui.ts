import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
const field=(value='',label='',options=[{value:'',label:''}])=>({value,label,options});
const fixture={truck:'Truck 1',status:field('1','Confirmed'),appointmentType:field('2','Job'),driver:{value:'d',label:'Fixture Driver'},drivers:[{value:'d',label:'Fixture Driver'}],navigators:[],navigatorOptions:[],loadQuantity:'1',loadSize:field(),loadPrices:[],loadPrice:'1200',bedloadQuantity:'',bedloadSize:field(),bedloadPrices:[],bedloadPrice:'',otherChargeOptions:[],otherCharges:[],discount:'',tip:'',jobCategory:field(),howHeard:field('ref','Referral',[{value:'ref',label:'Referral'}]),actualStartHour:field('12','12 PM',[{value:'12',label:'12 PM'}]),actualStartMinute:field('00','00',[{value:'00',label:'00'}]),actualEndHour:field('13','1 PM',[{value:'13',label:'1 PM'}]),actualEndMinute:field('00','00',[{value:'00',label:'00'}]),paymentMethods:[{value:'1',label:'Billed'},{value:'2',label:'Cash'},{value:'3',label:'Credit Card'},{value:'4',label:'Check'}],payments:[],balance:'1200.00',total:'$1,200.00'};
async function main(){
 const output=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Closeout from './desktop-ui/appointment-closeout';createRoot(document.getElementById('root')).render(<div className="ops-live"><Closeout job={{appointmentId:'1234',appointmentUrl:'https://example.invalid/appointment/1234',status:'Confirmed',appointmentType:'Job',id:'2026-09-09:appointment:1234',sourceVersion:'${'a'.repeat(64)}'}} date="2026-09-09" saved={()=>{}} onBusyChange={()=>{}}/></div>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'fixture',jsx:'automatic',alias:{react:process.cwd()+'/desktop-ui/node_modules/react','react-dom':process.cwd()+'/desktop-ui/node_modules/react-dom'}});
 const js=output.outputFiles.find(f=>f.path.endsWith('.js'))!.text,css=output.outputFiles.find(f=>f.path.endsWith('.css'))!.text;
 let posts=0;
 const server=createServer(async(req,res)=>{if(req.method==='POST'){posts++;res.writeHead(400);res.end('{}');return;}if(req.url?.includes('/api/desktop/schedule/closeout')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({closeout:fixture,sourceVersion:'a'.repeat(64),canWrite:true}));return;}if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}res.setHeader('Content-Type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}*{box-sizing:border-box}${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280]){const page=await browser.newPage({viewport:{width,height:844}});await page.goto(url);await page.getByText('Appointment Closeout',{exact:true}).click();await page.getByRole('checkbox',{name:'Add a payment'}).check();
  const methods=page.getByRole('group',{name:'Payment method',exact:true});assert.equal(await methods.getByRole('radio').count(),4);
  const method={selectOption:async(value:string)=>{const labels:Record<string,string>={'1':'Billed','2':'Cash','3':'Credit Card','4':'Check'};const radio=methods.getByRole('radio',{name:labels[value],exact:true});await radio.click();await expect(radio).toBeChecked();}};
  await method.selectOption('4');await page.getByRole('textbox',{name:'Payment amount',exact:true}).fill('1200');await page.getByRole('textbox',{name:'Check number',exact:true}).fill('009924');await page.getByRole('button',{name:'Review Closeout',exact:true}).click();await page.getByRole('button',{name:'Confirm Job Closeout in JunkWare',exact:true}).waitFor();assert.ok((await page.getByRole('status').textContent())?.includes('Check number: 009924'));
  await page.getByRole('textbox',{name:'Payment amount',exact:true}).fill('1199');await page.getByRole('button',{name:'Review Closeout',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Confirm Job Closeout in JunkWare',exact:true}).count(),0);
  await method.selectOption('3');const ref=page.getByRole('textbox',{name:'Card last four',exact:true});assert.equal(await ref.inputValue(),'');await page.getByRole('button',{name:'Review Closeout',exact:true}).click();await page.getByText('Enter only the four trailing card digits for the recorded payment.',{exact:true}).waitFor();await ref.fill('6004');await page.getByRole('button',{name:'Review Closeout',exact:true}).click();await page.getByRole('button',{name:'Confirm Job Closeout in JunkWare',exact:true}).waitFor();
  if(width===390) await page.screenshot({path:'/tmp/closeout-payment-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No mobile horizontal overflow');
  await method.selectOption('2');assert.equal(await page.getByRole('textbox',{name:'Card last four',exact:true}).count(),0);await page.getByRole('button',{name:'Reload from JunkWare',exact:true}).click();await page.getByRole('checkbox',{name:'Add a payment'}).waitFor();await expect(page.getByRole('checkbox',{name:'Add a payment'})).not.toBeChecked();await page.close();}
 const blockedPage=await browser.newPage();
 const moveReceipt={requestId:'fixture-move',action:'move',status:'uncertain',message:'Earlier assignment change remains unresolved.'};
 await blockedPage.route('**/api/desktop/schedule/closeout?*',route=>route.fulfill({json:{closeout:fixture,sourceVersion:'a'.repeat(64),canWrite:true,pendingReceipt:moveReceipt}}));
 await blockedPage.route('**/api/desktop/schedule/operations?*',route=>route.fulfill({json:{receipt:{...moveReceipt,status:'verified',message:'JunkWare confirms the saved truck and appointment window.'}}}));
 await blockedPage.goto(url);await blockedPage.getByText('Appointment Closeout',{exact:true}).click();
 await expect(blockedPage.getByRole('alert').last()).toContainText('This is not a closeout result');
 await expect(blockedPage.getByRole('button',{name:'Review Closeout',exact:true})).toBeDisabled();
 await blockedPage.getByRole('button',{name:'Check Saved Result',exact:true}).click();
 await expect(blockedPage.getByRole('button',{name:'Reload from JunkWare',exact:true})).toBeEnabled();
 await blockedPage.close();
 assert.equal(posts,0,'Review, edits, reload and assignment verification must never submit a closeout');console.log('Closeout UI passed at 390px and 1280px: payment review, validation, reload resets, earlier move blocker and safe verified-move reload, no overflow or save requests.');
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
}
void main();
