import {prepareJunkwareEmailSubmission} from '../lib/junkware-email';
import type {Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {capture} from './sync-junkware-job-closeout';
import {stableCloseoutChargeRows,closeoutSourceVersion} from '../lib/desktop-closeout-contract';
import {CUSTOMER_FIELDS,type CustomerFields,type CustomerSource,normalizeCustomerFields,verifyCustomerCorrection} from '../lib/crew-customer-contract';
import {clickWithWebFormsCompletion,setInputWithWebFormsPostback} from './junkware-webforms';

export const CUSTOMER_CONTROLS:Record<keyof CustomerFields,string>={firstName:'FirstNameTB',lastName:'LastNameTB',phone:'PhoneTB',alternatePhone:'Phone2TB',email:'EmailTB',serviceAddress:'AppointmentAddressTB',serviceZip:'AppointmentZipTB',serviceContactName:'ServiceContactNameTB',serviceContactPhone:'ServiceContactPhoneTB'};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function captureCustomer(page:Page,appointmentId:string):Promise<CustomerSource> {
  if(new URL(page.url()).pathname.toLowerCase()!=='/franchise/appointment.aspx' || new URL(page.url()).searchParams.get('id')!==appointmentId)throw new Error('The source appointment could not be identified.');
  const customer=await page.evaluate(({controls})=>{
    const fields={} as CustomerFields;
    for(const key of Object.keys(controls) as Array<keyof CustomerFields>){
      const node=document.getElementById('ctl00_Content_'+controls[key]);
      if(!(node instanceof HTMLInputElement))throw new Error('A customer correction field is unavailable.');
      fields[key]=node.value.trim();
    }
    const protectedFields=Object.fromEntries(['CustomerIDHF','FirstAppointmentHF','BillingAddressTB','BillingZipTB','BillingEmailTB','CompanyTB','OptOutCB'].map(key=>{
      const node=document.getElementById('ctl00_Content_'+key) as HTMLInputElement|null;
      return[key,node?.type==='checkbox'?node.checked:node?.value ?? null];
    }));
    if(!protectedFields.CustomerIDHF)throw new Error('Customer identity could not be verified.');
    return {fields,protectedFields,city:document.getElementById('ctl00_Content_AppointmentCityLbl')?.textContent?.trim()||'',state:document.getElementById('ctl00_Content_AppointmentStateLbl')?.textContent?.trim()||''};
  },{controls:CUSTOMER_CONTROLS});
  const source=await capture(page);
  // Render-specific charge IDs are not source changes. Every financial, crew,
  // scheduling and customer-account field remains part of the preservation proof.
  const preserved={...source,otherCharges:stableCloseoutChargeRows(source.otherCharges)};
  const protectedVersion=hash({appointmentId,closeout:closeoutSourceVersion(preserved),fields:customer.protectedFields});
  const dateText=String((source.appointmentWindow as {date?:string})?.date||'');
  const match=dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const date=match?`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`:dateText;
  return {appointmentId,fields:customer.fields,protectedVersion,sourceVersion:hash({protectedVersion,fields:customer.fields,city:customer.city,state:customer.state}),status:source.status.value,truck:String(source.truck||''),date,city:customer.city,state:customer.state};
}
async function stageCustomerCorrection(page:Page,before:CustomerSource,fields:CustomerFields){
  // ZIP selection is an unsaved Web Forms postback. Never select a suggested
  // address or alter billing details. Reapply the reviewed fields after it ends.
  if(fields.serviceZip!==before.fields.serviceZip)await setInputWithWebFormsPostback(page,'#ctl00_Content_AppointmentZipTB',fields.serviceZip,'the service ZIP update');
  await page.evaluate(({fields,controls,changed})=>{
    for(const key of Object.keys(controls) as Array<keyof CustomerFields>){
      const node=document.getElementById('ctl00_Content_'+controls[key]);
      if(!(node instanceof HTMLInputElement) || node.disabled || node.readOnly)throw new Error('The customer form changed.');
      node.value=fields[key];
    }
    if(changed){const flag=document.getElementById('ctl00_Content_AddressChangedHF');if(!(flag instanceof HTMLInputElement))throw new Error('The service address change control is unavailable.');flag.value='true';}
    const send=document.getElementById('ctl00_Content_SendPicturesCB');if(send instanceof HTMLInputElement)send.checked=false;
  },{fields,controls:CUSTOMER_CONTROLS,changed:fields.serviceAddress!==before.fields.serviceAddress||fields.serviceZip!==before.fields.serviceZip});
}
const correctionSteps={capture:captureCustomer,stage:stageCustomerCorrection,submit:(page:Page)=>clickWithWebFormsCompletion(page,'#ctl00_Content_SaveAppointmentBtn','the customer correction')};
export async function applyCustomerCorrection(page:Page,before:CustomerSource,input:unknown,markSubmission:()=>void,steps=correctionSteps) {
  const fields=normalizeCustomerFields(input);
  fields.email=prepareJunkwareEmailSubmission(fields.email).controlValue;
  if(before.status!=='1')throw new Error('Only open appointments can be corrected by the crew.');
  await steps.stage(page,before,fields);
  verifyCustomerCorrection(await steps.capture(page,before.appointmentId),fields,before.protectedVersion);
  const url=page.url();
  markSubmission();
  try {await steps.submit(page);}
  catch {/* A lost response does not establish that Save failed. Fresh read-back decides. */}
  await page.goto(url,{waitUntil:'domcontentloaded'});
  const saved=await steps.capture(page,before.appointmentId);
  verifyCustomerCorrection(saved,fields,before.protectedVersion);
  return saved;
}
