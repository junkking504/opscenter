import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
import {isAmazonJob,isAmazonAssignee,parseSignature,requireAmazonSignature,hasSavedSignature,verifyAmazonSignature} from '../lib/amazon-closeout';
import {signatureImage,signatureHash,readSignature,saveSignature} from './junkware-signature';
import {closeoutCrewDefaults} from '../lib/crew-phone-day';

async function main(){
 const drawing={strokes:[[[10,20],[30,50],[70,15],[110,40]]]};
 assert.ok(isAmazonJob({companyName:'Amazon Mattress Removal'}));
 assert.ok(isAmazonJob({address:'Amazon Mattress Removal 100 Example St',customerName:'Example'}));
 assert.equal(isAmazonJob({companyName:'Other Business',customerName:'Amazon'}),false);
 assert.equal(isAmazonJob({address:'100 Amazon Street',appointmentNotes:['Amazon mattress']}),false);
 for(const name of ['Dabezies, Eugene','Eugene Dabezies','McLaughlin, Robert','Robert McLaughlin','Gerard, Lance','Lance Gerard'])assert.ok(isAmazonAssignee(name));
 assert.equal(isAmazonAssignee('Lance Someone Else'),false);
 for(const value of [null,{}, {strokes:[]},{strokes:[[[10,10],[10,10],[10,10]]]}, {strokes:[[[1,1],[20,10],[601,20]]]}, {strokes:[[[1,1],[NaN,10],[20,20]]]}, {strokes:[Array.from({length:2001},(_,i)=>[i%600,10])]}])assert.throws(()=>parseSignature(value));
 const parsed=parseSignature(drawing);
 const blank=await sharp({create:{width:600,height:200,channels:3,background:'white'}}).png().toBuffer();
 await assert.rejects(signatureHash(blank),/blank/);
 const hash=await signatureHash(await signatureImage(parsed));
 const source={companyName:'Amazon Mattress Removal',signatureEvidence:{appointmentId:'123',sha256:hash}};
 assert.throws(()=>verifyAmazonSignature(source,{...source,companyName:'Another Company'},'8','123'),/company changed/);
 assert.throws(()=>verifyAmazonSignature(source,{...source,signatureEvidence:null},'8','123'),/signature is required/);
 assert.throws(()=>verifyAmazonSignature(source,{...source,signatureEvidence:{appointmentId:'123',sha256:'f'.repeat(64)}},'8','123'),/did not retain/);
 assert.ok(hasSavedSignature(source,'123'));assert.equal(hasSavedSignature(source,'124'),false);
 assert.doesNotThrow(()=>requireAmazonSignature(source,'8','123'));
 assert.throws(()=>requireAmazonSignature(source,'8','124'),/signature is required/);
 assert.throws(()=>requireAmazonSignature({...source,signatureEvidence:null},'8','123'),/signature is required/);
 assert.doesNotThrow(()=>requireAmazonSignature({...source,signatureEvidence:null},'1','123'));
 assert.doesNotThrow(()=>requireAmazonSignature({...source,signatureEvidence:null},'8','123',parsed));
 const day={version:3,driver:'Different Crew',navigators:['Different Navigator']} as Parameters<typeof closeoutCrewDefaults>[0];
 for(const label of ['Dabezies, Eugene','McLaughlin, Robert','Gerard, Lance']){
  const driver={value:'assigned',label},navigators=[{value:'saved-nav',label:'Saved Navigator'}];
  assert.deepEqual(closeoutCrewDefaults(day,{...source,driver,navigators}),{version:3,driver,navigators});
 }
 assert.throws(()=>closeoutCrewDefaults(day,{...source,driver:{value:'other',label:'Other Driver'},navigators:[]}),/office must assign/);
 let stored='',posts=0,ignoreSave=false;
 const server=createServer(async(req,res)=>{
  if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;posts++;const fields=new URLSearchParams(body);assert.ok(fields.has('ctl00$Content$SaveSignatureBtn'));if(!ignoreSave)stored=fields.get('ctl00$Content$SignatureHF') || '';}
  res.setHeader('Content-Type','text/html');res.end(`<form method="post"><input id="ctl00_Content_SignatureHF" name="ctl00$Content$SignatureHF" type="hidden"><input id="ctl00_Content_SaveSignatureBtn" name="ctl00$Content$SaveSignatureBtn" type="submit" value="Save" style="display:none">${stored?`<img id="ctl00_Content_SignatureImage" src="${stored}">`:''}</form>`);
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/appointment.aspx?id=123`;
  await page.goto(url);assert.equal(await readSignature(page),null);
  assert.deepEqual(await saveSignature(page,parsed),{appointmentId:'123',sha256:hash});assert.equal(posts,1);
  assert.deepEqual(await saveSignature(page,parsed),{appointmentId:'123',sha256:hash});assert.equal(posts,1,'Already saved exact image is not posted twice');
  await assert.rejects(saveSignature(page,{strokes:[[[10,10],[70,90],[120,40]]]}),/already saved/);assert.equal(posts,1);
  stored='';ignoreSave=true;await page.goto(url);
  await assert.rejects(saveSignature(page,parsed),/did not retain/);assert.equal(posts,2,'An unverified save is attempted once, never replayed');
  stored=`data:image/png;base64,${blank.toString('base64')}`;await page.goto(url);await assert.rejects(readSignature(page),/blank/);
 }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 console.log('PASS: Amazon identity, assignees, bounded nonblank signatures, native save/reopen pixel verification, already-saved idempotence and failed read-back without replay. Synthetic provider only.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
