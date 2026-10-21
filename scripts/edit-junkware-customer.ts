import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {closeoutSourceVersion} from '../lib/desktop-closeout-contract';
import {chromium,type Page} from '@playwright/test';
import {ensureAuthenticated} from './reschedule-junkware-appointment';
import {capture} from './sync-junkware-job-closeout';
import {clickWithWebFormsCompletion,setInputWithWebFormsPostback} from './junkware-webforms';
import {customerFields,customerMatches,customerNotesMatch,suggestedCustomerOutcome,parseCustomerChange,type CustomerDetails,type CustomerChange} from '../lib/customer-edit-contract';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function readCustomer(page:Page) {
  const customer={} as CustomerDetails;
  for(const [key,id] of Object.entries(customerFields)) {
    const field=page.locator('#ctl00_Content_'+id);
    if(await field.count()!==1)throw new Error('JunkWare customer controls have changed.');
    customer[key as keyof CustomerDetails]=(await field.inputValue()).trim();
  }
  const customerId=await page.locator('#ctl00_Content_CustomerIDHF').inputValue();
  if(!/^\d+$/.test(customerId))throw new Error('The source customer identity is unavailable.');
  const city=await page.locator('#ctl00_Content_AppointmentCityLbl').count() ? (await page.locator('#ctl00_Content_AppointmentCityLbl').textContent() || '').trim() : '';
  const state=await page.locator('#ctl00_Content_AppointmentStateLbl').count() ? (await page.locator('#ctl00_Content_AppointmentStateLbl').textContent() || '').trim() : '';
  const displayAddress=city && state ? `${customer.address}, ${city}, ${state} ${customer.zip}` : '';
  const protectedFields=await capture(page);
  const {appointmentNotes:notes,...preserved}=protectedFields;
  const appointmentNotes=Array.isArray(notes)?notes.map(String):[];
  const protectedVersion=closeoutSourceVersion({...preserved,customerId});
  const requiresEstimateOutcome=protectedFields.status.value==='8' && (protectedFields.appointmentType as {label?:string}).label==='Estimate';
  const requiresNoDiscountReason=requiresEstimateOutcome && !(Number(String(protectedFields.discount || '').replace(/[^0-9.-]/g,''))>0);
  return {customer,customerId,displayAddress,protectedVersion,appointmentNotes,requiresEstimateOutcome,requiresNoDiscountReason,estimateOutcome:requiresEstimateOutcome?suggestedCustomerOutcome(appointmentNotes):undefined,sourceVersion:hash({customer,protectedVersion,appointmentNotes}),checkedAt:new Date().toISOString()};
}
export async function editCustomerOnPage(page:Page,change:CustomerChange,reopen:()=>Promise<void>) {
  let submitted=false;
  try {
    const before=await readCustomer(page);
    if(before.sourceVersion!==change.expectedSourceVersion || before.protectedVersion!==change.protectedVersion)throw new Error('Customer or appointment details changed. Reload before saving.');
    if(!customerNotesMatch(before.appointmentNotes,change.appointmentNotes || []) || before.requiresEstimateOutcome && !change.estimateOutcome || before.requiresNoDiscountReason && !change.estimateOutcome?.noDiscountReason)throw new Error('Confirm the current closed-estimate outcome and no-discount explanation before saving.');
    if(!before.requiresEstimateOutcome && change.estimateOutcome)throw new Error('This customer edit does not require an estimate outcome.');
    if(before.estimateOutcome && change.estimateOutcome){
      const original=before.estimateOutcome,requested=change.estimateOutcome;
      if(original.reason!==requested.reason || original.explanation!==requested.explanation || before.requiresNoDiscountReason && original.noDiscountReason && original.noDiscountReason!==requested.noDiscountReason)throw new Error('Keep the existing estimate outcome when correcting customer information.');
    }
    // Expand the native sections without submitting any source changes.
    await page.locator('#customer-info-div').evaluate(node=>{node.classList.add('in');(node as HTMLElement).style.display='block';}).catch(()=>{});
    for(const [key,id] of Object.entries(customerFields)) {
      if(key==='zip')continue;
      const field=page.locator('#ctl00_Content_'+id);
      await field.evaluate((node,value)=>{(node as HTMLInputElement).value=value;},change.customer[key as keyof CustomerDetails]);
    }
    if(before.customer.zip!==change.customer.zip) await setInputWithWebFormsPostback(page,'#ctl00_Content_AppointmentZipTB',change.customer.zip,'the service ZIP update');
    // Native .iu-trig-field change marks IsUpdatedHF; native .address-entry
    // change marks AddressChangedHF. Reproduce those markers without scheduling
    // another ZIP postback. IsUpdatedHF also drives the native unsaved-change guard.
    await page.evaluate(({addressChanged})=>{
      const updated=document.getElementById('ctl00_Content_IsUpdatedHF') as HTMLInputElement|null;if(updated)updated.value='true';
      const address=document.getElementById('ctl00_Content_AddressChangedHF') as HTMLInputElement|null;if(address && addressChanged)address.value='true';
      const pictures=document.getElementById('ctl00_Content_SendPicturesCB') as HTMLInputElement|null;if(pictures)pictures.checked=false;
    },{addressChanged:before.customer.address!==change.customer.address || before.customer.zip!==change.customer.zip});
    const staged=await readCustomer(page);
    if(!customerMatches(staged.customer,change.customer) || staged.protectedVersion!==before.protectedVersion || !customerNotesMatch(before.appointmentNotes,staged.appointmentNotes))throw new Error('JunkWare changed other appointment details while preparing the customer edit. Review the source.');
    submitted=true;
    try {await clickWithWebFormsCompletion(page,'#ctl00_Content_SaveAppointmentBtn','the customer update');} catch { /* A lost save response requires read-back, never a second save. */ }
    const outcomeButton=page.locator('#ctl00_Content_UENoteOkBtn');
    if(await outcomeButton.isVisible()){
      if(!before.requiresEstimateOutcome || !change.estimateOutcome)throw new Error('JunkWare requested an unexpected estimate outcome. Check the saved result.');
      const confirmation=await readCustomer(page);
      if(!customerMatches(confirmation.customer,change.customer) || confirmation.protectedVersion!==before.protectedVersion || !customerNotesMatch(before.appointmentNotes,confirmation.appointmentNotes))throw new Error('JunkWare changed appointment details before the outcome confirmation. Do not finish this save.');
      const outcome=change.estimateOutcome;
      await page.locator('#ctl00_Content_UEReasonDD').evaluate((node,reason)=>{const select=node as HTMLSelectElement;if(![...select.options].some(option=>option.value===reason))throw new Error('The estimate outcome option is unavailable.');select.value=reason;},outcome.reason);
      await page.locator('#ctl00_Content_UENoteTB').fill(outcome.explanation);
      if(await page.locator('#ctl00_Content_UENoDiscountTB').isVisible()){
        if(!outcome.noDiscountReason)throw new Error('JunkWare requires the no-discount explanation.');
        await page.locator('#ctl00_Content_UENoDiscountTB').fill(outcome.noDiscountReason);
      }
      const pictures=page.locator('#ctl00_Content_SendPicturesCB');if(await pictures.count())await pictures.evaluate(node=>{(node as HTMLInputElement).checked=false;});
      // This is the native second phase of the same save, not a repeated Save Appointment.
      try{await clickWithWebFormsCompletion(page,'#ctl00_Content_UENoteOkBtn','the closed-estimate customer correction');}catch{/* Fresh read-back decides; never repeat either phase. */}
    }
    await reopen();
    const result=await readCustomer(page);
    if(!customerMatches(result.customer,change.customer) || result.protectedVersion!==before.protectedVersion || !customerNotesMatch(before.appointmentNotes,result.appointmentNotes,before.requiresEstimateOutcome?change.estimateOutcome:undefined))throw new Error('JunkWare has not verified the requested customer information while preserving appointment details. Check the saved result.');
    return {ok:true,submitted,...result,previousCustomer:before.customer,verifiedAt:new Date().toISOString()};
  } catch(error) {return {ok:false,submitted,error:error instanceof Error?error.message:'Customer save could not be verified.'};}
}
async function main() {
  const input=JSON.parse(fs.readFileSync(0,'utf8'));
  if(!/^\d{1,12}$/.test(String(input.appointmentId)))throw new Error('A valid appointment is required.');
  const change=input.change?parseCustomerChange(input.change):undefined;
  const browser=await chromium.launch({headless:true});
  try {
    const storage=path.join(process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data'),'protected/junkware_storage_state.json');
    const context=await browser.newContext(fs.existsSync(storage)?{storageState:storage}:{});
    const page=await context.newPage();page.setDefaultTimeout(30000);
    const target=`https://junkware.junk-king.com/franchise/appointment.aspx?id=${input.appointmentId}`;
    const reopen=()=>ensureAuthenticated(page,target);await reopen();
    const result=change?await editCustomerOnPage(page,change,reopen):{ok:true,...await readCustomer(page)};
    process.stdout.write(JSON.stringify(result));
  }finally{await browser.close();}
}
if(process.argv[1]?.endsWith('edit-junkware-customer.ts')) main().catch(()=>{process.stdout.write(JSON.stringify({ok:false,submitted:false,error:'JunkWare customer information is unavailable.'}));process.exitCode=1;});
