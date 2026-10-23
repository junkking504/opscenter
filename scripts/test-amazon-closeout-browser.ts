import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {chromium,expect} from '@playwright/test';

async function main(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'amazon-closeout-browser-'));
 const result=await build({stdin:{contents:`
 import {createRoot} from 'react-dom/client';
 import AppointmentCloseout from './desktop-ui/appointment-closeout';
 import {fixture} from './scripts/fixtures/crew-closeout';
 import './desktop-ui/mobile-closeout/mobile-closeout.css';
 const mobile=new URLSearchParams(location.search).has('mobile');
 const savedSignature=new URLSearchParams(location.search).has('signed');
 const source={...fixture,companyName:'Amazon Mattress Removal',signatureEvidence:savedSignature?{appointmentId:'123',sha256:'a'.repeat(64)}:null,driver:{value:'lance',label:'Gerard, Lance'},drivers:[{value:'lance',label:'Gerard, Lance'}],navigators:[],photoEvidence:{appointmentId:'123',urls:['https://junkware.junk-king.com/system/aspnet/local/media/photo-123-before.jpg']}};
 const payload={closeout:source,sourceVersion:'a'.repeat(64),canWrite:true,crewDefaults:{version:1,driver:source.driver,navigators:[]}};
 window.__writes=[];
 const send=async(values,requestId)=>{window.__writes.push(values);return {requestId,status:'failed',message:'Synthetic test: no appointment changed.'};};
 window.fetch=async(input,init)=>String(input).includes('/operations')?Response.json({receipt:await send(JSON.parse(init.body).values,JSON.parse(init.body).requestId)}):Response.json(payload);
 const transport={load:async()=>payload,send,check:async()=>null};
 createRoot(document.getElementById('root')).render(<div className={mobile?'crew-mobile ops-live':'ops-live'}><AppointmentCloseout job={{appointmentId:'123',appointmentUrl:'',status:'Confirmed',appointmentType:'Job',truck:'Truck 6',jkNumber:'TEST-AMAZON',customerName:'Synthetic Customer',recordId:'2026-10-16:appointment:123',version:'a'.repeat(64)}} date="2026-10-16" saved={()=>{}} onBusyChange={()=>{}} presentation={mobile?'mobile':'drawer'} transport={mobile?transport:undefined} draftKey={mobile?'test-amazon':undefined} photoSteps={mobile?{render:()=>null,hasPhotos:true,busy:false}:undefined}/></div>);
 `,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'out',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},alias:{react:path.resolve('desktop-ui/node_modules/react'),'react-dom':path.resolve('desktop-ui/node_modules/react-dom')}});
 const js=result.outputFiles.find(f=>f.path.endsWith('.js'))!.text,css=result.outputFiles.find(f=>f.path.endsWith('.css'))!.text;
 const html=`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;box-sizing:border-box}*{box-sizing:border-box}${css}</style></head><body><div id="root"></div><script>${js.replaceAll('</script','<\\/script')}</script></body></html>`;
 const browser=await chromium.launch({headless:true});
 try{
  for(const mobile of [false,true])for(const width of (mobile?[320,390,430]:[1280])){
   const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
   await page.route('https://fixture.invalid/**',route=>route.fulfill({contentType:'text/html',body:html}));
   await page.goto(`https://fixture.invalid/${mobile?'?mobile':''}`);
   if(!mobile){await page.locator('summary').click();await page.getByRole('radio',{name:'Completed',exact:true}).check();}
   else {await page.getByRole('button',{name:'Continue to charges',exact:true}).click();await page.getByRole('button',{name:'Continue to after photos',exact:true}).click();await page.getByRole('button',{name:'Continue to payment',exact:true}).click();}
   const pad=page.getByRole('img',{name:'Customer signature drawing area'});await expect(pad).toBeVisible();
   await page.getByRole('button',{name:'Review Closeout',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'A customer signature is required'})).toBeVisible();
   const draw=async()=>{await pad.scrollIntoViewIfNeeded();const box=(await pad.boundingBox())!;await page.mouse.move(box.x+25,box.y+30);await page.mouse.down();await page.mouse.move(box.x+85,box.y+100,{steps:8});await page.mouse.move(box.x+140,box.y+35,{steps:8});await page.mouse.up();};
   await draw();await page.getByRole('button',{name:'Clear signature',exact:true}).click();assert.equal(await pad.locator('polyline').count(),0);
   await draw();
   if(mobile){await page.reload();await expect(page.getByText('Draft restored against the current JunkWare record. Review before saving.')).toBeVisible();await expect(pad).toBeVisible();assert.equal(await pad.locator('polyline').count(),1);}
   const captureDir=process.env.AMAZON_SCREENSHOT_DIR;if(captureDir){await fs.mkdir(captureDir,{recursive:true});await page.screenshot({path:path.join(captureDir,`amazon-pad-${mobile?'waypoint':'opscenter'}-${width}.png`),fullPage:true});}
   await page.getByRole('button',{name:'Review Closeout',exact:true}).click();await expect(page.getByText('Captured · saves with closeout')).toBeVisible();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const screenshot=process.env.AMAZON_SCREENSHOT_DIR;if(screenshot){await fs.mkdir(screenshot,{recursive:true});await page.screenshot({path:path.join(screenshot,`amazon-${mobile?'waypoint':'opscenter'}-${width}.png`),fullPage:true});}
   await page.getByRole('button',{name:mobile?'Submit checkout':'Confirm Job Closeout in JunkWare',exact:true}).click();
   await expect(page.getByText('Synthetic test: no appointment changed.')).toBeVisible();
   const writes=await page.evaluate(()=>(window as unknown as {__writes:Record<string,unknown>[]}).__writes);assert.equal(writes.length,1);assert.ok((writes[0].signature as {strokes:unknown[]}).strokes.length);assert.equal(writes[0].driverId,'lance');
   assert.deepEqual(errors,[]);await context.close();
  }
 }finally{await browser.close();await fs.rm(dir,{recursive:true,force:true});}
 console.log('PASS: OpsCenter and Waypoint required signature, clear/redraw, draft restoration, review, preserved assignee and submit at desktop/320/390/430px. No provider calls.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
