import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
async function main(){
 const origin=process.argv[2] || 'http://127.0.0.1:3189';
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [320,390,430]){
   const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();
   const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
   let connected=true,uploads=0,uncertain=false,waiting=false;
   const phone={deviceId:randomUUID(),truck:'Truck 6',label:'Synthetic company phone',enrolledAt:new Date().toISOString(),expiresAt:'2027-01-01T00:00:00Z'};
   const assignmentId=randomUUID(),receipts:Array<{requestId:string;category:string;status:string}>=[];
   await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    const send=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname==='/api/crew-jobs/session'){
     if(request.method()==='POST'){connected=false;return send({disconnected:true});}
     return connected?send({phone}):send({error:'This phone needs manager setup.'},401);
    }
    if(url.pathname==='/api/crew-jobs/current')return send(waiting?{state:'waiting',truck:'Truck 6',job:null}:{state:'assigned',truck:'Truck 6',observedAt:new Date().toISOString(),job:{assignmentId,appointmentId:'900001',date:'2026-09-18',jkNumber:'SAMPLE-01',customerName:'Sample current customer',address:'100 Sample Street',appointmentTime:'10 AM–12 PM',junkItems:['Garage cleanout'],appointmentNotes:['Side door'],driver:'Sample Driver',navigator:'Sample Navigator'}});
    if(url.pathname==='/api/crew-jobs/photos'){
     if(request.method()==='POST'){
      uploads++;const body=request.postDataJSON();assert.equal(body.assignmentId,assignmentId);assert.equal(body.appointmentId,undefined);
      const receipt={requestId:body.requestId,category:body.category,status:'verified'};receipts.push(receipt);
      if(uncertain)return route.abort();return send({receipt});
     }
     const id=url.searchParams.get('requestId');return id?send({receipt:receipts.find(row=>row.requestId===id)}):send({photos:receipts});
    }
    throw new Error(`Unexpected API ${request.method()} ${url.pathname}`);
   });
   await page.goto(`${origin}/crew-jobs`);
   await expect(page.getByRole('heading',{name:'Current job',exact:true})).toBeVisible();
   await page.getByRole('button',{name:'View job',exact:true}).click();
   await expect(page.getByLabel('Add before photos',{exact:true})).toBeEnabled();
   // Use a browser-generated JPEG; no external file, camera or provider is touched.
   const base64=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;const c=canvas.getContext('2d')!;c.fillStyle='red';c.fillRect(0,0,4,4);return canvas.toDataURL('image/jpeg').split(',')[1];});
   await page.getByLabel('Add before photos',{exact:true}).setInputFiles({name:'sample.jpg',mimeType:'image/jpeg',buffer:Buffer.from(base64,'base64')});
   await expect(page.getByText('Selected · not uploaded',{exact:true})).toBeVisible();
   assert.equal(uploads,0,'Selecting photos does not upload');
   await page.reload();await page.getByRole('button',{name:'View job',exact:true}).click();
   await expect(page.getByText('Selected · not uploaded',{exact:true})).toBeVisible();
   uncertain=true;await page.getByRole('button',{name:'Upload photo',exact:true}).click();
   await expect(page.getByRole('button',{name:'Check saved photo',exact:true})).toBeVisible();
   assert.equal(uploads,1);
   await page.getByRole('button',{name:'Check saved photo',exact:true}).click();
   await expect(page.getByText('Saved in JunkWare',{exact:true})).toBeVisible();assert.equal(uploads,1,'Checking a lost response never uploads twice');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No horizontal overflow at ${width}`);
   await page.getByRole('button',{name:'Disconnect company phone',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Company phone setup',exact:true})).toBeVisible();
   await expect.poll(()=>page.evaluate(()=>new Promise<number>((resolve,reject)=>{const r=indexedDB.open('ops-crew-photo-drafts-v1');r.onsuccess=()=>{const db=r.result;const t=db.transaction('drafts');const q=t.objectStore('drafts').count();t.oncomplete=()=>{resolve(q.result);db.close();};};r.onerror=()=>reject(r.error);}))).toBe(0);
   connected=true;waiting=true;await page.reload();await expect(page.getByRole('heading',{name:'Waiting for assignment',exact:true})).toBeVisible();
   assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${width}px: current-only view, durable photo selection, lost upload response -> read-only recovery, disconnect clears drafts, waiting state, no overflow.`);
  }
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
