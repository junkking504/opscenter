import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import {readCustomer,editCustomerOnPage} from './edit-junkware-customer';
import {customerFields,customerOutcomeText,customerNotesMatch,suggestedCustomerOutcome,parseCustomerChange,type CustomerDetails} from '../lib/customer-edit-contract';
async function main(){
 const original:CustomerDetails={firstName:'Test',lastName:'Customer',phone:'5045550100',secondaryPhone:'',email:'test@example.com',address:'100 Example St',zip:'70112'};
 const outcome={reason:'Date/Time' as const,explanation:'Customer requested a later date',noDiscountReason:'Original explanation'};
 const originalNote=customerOutcomeText(outcome)+' (10/20/2026 1:00 PM , Source)';
 let mode='',state={...original},notes=[originalNote],pending:CustomerDetails|null=null,initialSaves=0,finalSaves=0,phase=false,money='100.00';
 const isEstimate=()=>!mode.startsWith('job');
 const status=()=>mode==='canceled'?'9':'8';
 const html=()=>{
  const values=phase&&pending?pending:state;
  return `<form method="post"><div id="customer-info-div"></div><input type="hidden" name="__EVENTTARGET"><input type="hidden" name="__EVENTARGUMENT"><input id="ctl00_Content_CustomerIDHF" value="123"><span id="ctl00_Content_AppointmentCityLbl">New Orleans</span><span id="ctl00_Content_AppointmentStateLbl">LA</span>${Object.entries(customerFields).map(([key,id])=>`<input id="ctl00_Content_${id}" name="${key}" value="${values[key as keyof CustomerDetails]}">`).join('')}<input id="ctl00_Content_IsUpdatedHF"><input id="ctl00_Content_AddressChangedHF"><input id="ctl00_Content_StartTimeTB" value="9:00 AM"><input id="ctl00_Content_AppointmentDateTB" value="10/21/2026"><input id="ctl00_Content_BillingAmountTB" value="${money}"><input id="ctl00_Content_DiscountsTB" value="${mode==='estimate-discount'?'10':'0'}"><input id="ctl00_Content_TipsTB" value="5"><span id="ctl00_Content_TotalLbl">${money}</span><select id="ctl00_Content_AppointmentTypeDD"><option>${isEstimate()?'Estimate':'Job'}</option></select><select id="ctl00_Content_StatusDD"><option value="${status()}">${status()==='9'?'Cancelled':'Completed'}</option></select><select id="ctl00_Content_TruckDD"><option>Truck# 9</option></select>${notes.map((note,i)=>`<span id="ctl00_Content_NotesLV_ctrl${i}_NoteLbl">${note}</span>`).join('')}<input id="ctl00_Content_SendPicturesCB" type="checkbox" checked><input id="ctl00_Content_SaveAppointmentBtn" type="submit" name="save" value="Save">${phase?`<div id="outcome" ${mode==='estimate-delayed'?'hidden':''}><select id="ctl00_Content_UEReasonDD" name="reason"><option>Price/Budget</option><option>Date/Time</option><option>Other</option></select><textarea id="ctl00_Content_UENoteTB" name="explanation"></textarea>${mode==='estimate-discount'?'':'<textarea id="ctl00_Content_UENoDiscountTB" name="noDiscountReason"></textarea>'}<input id="ctl00_Content_UENoteOkBtn" type="submit" name="finish" value="Confirm outcome"></div>${mode==='estimate-delayed'?'<script>setTimeout(()=>document.getElementById("outcome").hidden=false,350)</script>':''}`:''}</form>`;
 };
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;const data=new URLSearchParams(body);
  if(req.method==='POST'){
   if(data.has('save')){
    initialSaves++;const next=Object.fromEntries(Object.keys(customerFields).map(key=>[key,data.get(key)||''])) as CustomerDetails;
    if(isEstimate() && status()==='8'){pending=next;phase=true;if(mode==='estimate-stage-financial-change')money='200.00';}else{state=next;if(mode==='job-lost'){res.writeHead(500);res.end('lost');return;}}
   }
   if(data.has('finish')){
    finalSaves++;assert.equal(data.has('save'),false,'The initial Save is not repeated');
    if(mode!=='estimate-mismatch')state={...pending!};
    notes.push(customerOutcomeText({reason:data.get('reason') as 'Date/Time',explanation:data.get('explanation')||'',noDiscountReason:data.get('noDiscountReason')||''})+' (10/21/2026 2:00 PM , Manager)');
    if(mode==='estimate-financial-change')money='200.00';
    if(mode==='estimate-removed-note')notes.shift();
    phase=false;
    if(mode==='estimate-lost'){res.writeHead(500);res.end('lost');return;}
   }
  }else phase=false;
  res.setHeader('Content-Type','text/html');res.end(html());
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/franchise/appointment.aspx?id=123`;
 const browser=await chromium.launch();
 try{
  for(const scenario of ['job','job-lost','estimate','estimate-discount','estimate-delayed','estimate-lost','estimate-mismatch','estimate-financial-change','estimate-stage-financial-change','estimate-removed-note','estimate-missing-confirmation','estimate-stale-note','estimate-changed-outcome','canceled']){
   mode=scenario;state={...original};notes=[originalNote];pending=null;initialSaves=0;finalSaves=0;phase=false;money='100.00';const page=await browser.newPage();await page.goto(url);const before=await readCustomer(page);
   assert.equal(before.requiresEstimateOutcome,isEstimate()&&status()==='8',scenario);
   const change=parseCustomerChange({customer:{...original,lastName:'Corrected'},expectedSourceVersion:before.sourceVersion,protectedVersion:before.protectedVersion,appointmentNotes:scenario==='estimate-stale-note'?[]:before.appointmentNotes,...(before.requiresEstimateOutcome && scenario!=='estimate-missing-confirmation'?{estimateOutcome:{...outcome,...(scenario==='estimate-changed-outcome'?{reason:'Other'}:{}),...(scenario==='estimate-discount'?{noDiscountReason:undefined}:{})}}:{})});
   const result=await editCustomerOnPage(page,change,async()=>{await page.goto(url);});
   const preflight=['estimate-missing-confirmation','estimate-stale-note','estimate-changed-outcome'].includes(scenario);
   assert.equal(initialSaves,preflight?0:1,scenario);assert.equal(finalSaves,!preflight&&isEstimate()&&status()==='8'&&scenario!=='estimate-stage-financial-change'?1:0,scenario);
   const expected=!preflight&&!['estimate-mismatch','estimate-financial-change','estimate-stage-financial-change','estimate-removed-note'].includes(scenario);
   assert.equal(result.ok,expected,scenario);
   if(expected){assert.equal(state.lastName,'Corrected');assert.equal(money,'100.00');assert.ok(notes.includes(originalNote));}
   await page.close();
  }
  assert.deepEqual(suggestedCustomerOutcome([originalNote]),outcome);
  assert.equal(customerNotesMatch([originalNote],[originalNote,customerOutcomeText(outcome)+' (10/21/2026 2:00 PM , Manager)'],outcome),true);
  assert.equal(customerNotesMatch([originalNote],[originalNote,'Other: Unexpected (10/21/2026 2:00 PM , Manager)'],outcome),false);
  console.log('Closed customer source fixtures passed: completed jobs, canceled records, closed estimates with native two-phase save, retained original outcome, discounted estimate, lost responses, one submit per phase, stale notes, missing confirmation, changed money and deleted notes. No live writes.');
 }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
void main();
