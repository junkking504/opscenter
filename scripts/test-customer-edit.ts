import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
import {customerFields,parseCustomerChange,type CustomerDetails} from '../lib/customer-edit-contract';
import {readCustomer,editCustomerOnPage} from './edit-junkware-customer';
import {parseScheduleOperation} from '../lib/desktop-schedule-operations';
async function main(){
  const original:CustomerDetails={firstName:'Test',lastName:'Customer',phone:'5045550100',secondaryPhone:'',email:'test@example.com',address:'100 Example St',zip:'70112'};
  let state={...original},mode='',saves=0,changedTime=false;
  const html=()=>`<form method="post"><div id="customer-info-div"></div><input type="hidden" name="__EVENTTARGET"><input type="hidden" name="__EVENTARGUMENT"><input id="ctl00_Content_CustomerIDHF" value="123">${Object.entries(customerFields).map(([key,id])=>`<input id="ctl00_Content_${id}" name="${key}" value="${state[key as keyof CustomerDetails]}">`).join('')}<input id="ctl00_Content_StartTimeTB" value="${changedTime?'10:00 AM':'9:00 AM'}"><input id="ctl00_Content_AppointmentDateTB" value="10/21/2026"><select id="ctl00_Content_StatusDD"><option value="1">Confirmed</option></select><input id="ctl00_Content_SaveAppointmentBtn" type="submit" name="save" value="Save"></form>`;
  const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;if(req.method==='POST'){saves++;if(mode!=='mismatch'){const data=new URLSearchParams(body);for(const key of Object.keys(customerFields))state[key as keyof CustomerDetails]=data.get(key) || '';if(mode==='preservation')changedTime=true;}if(mode==='lost'){res.writeHead(500);res.end('lost response');return;}}res.setHeader('Content-Type','text/html');res.end(html());});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/franchise/appointment.aspx?id=123`;
  const browser=await chromium.launch();
  try{
    for(const scenario of ['save','lost','mismatch','conflict','preservation']){
      mode=scenario;state={...original};saves=0;changedTime=false;const page=await browser.newPage();await page.goto(url);const before=await readCustomer(page);
      const change=parseCustomerChange({customer:{...before.customer,firstName:'Updated',email:'',address:'200 Example St'},expectedSourceVersion:scenario==='conflict'?'0'.repeat(64):before.sourceVersion,protectedVersion:before.protectedVersion});
      const result=await editCustomerOnPage(page,change,async()=>{await page.goto(url);});
      assert.equal(saves,scenario==='conflict'?0:1,scenario);assert.equal(result.ok,['save','lost'].includes(scenario),scenario);assert.equal(result.submitted,scenario!=='conflict',scenario);await page.close();
    }
    const good={customer:original,expectedSourceVersion:'a'.repeat(64),protectedVersion:'b'.repeat(64)};
    for(const customer of [{...original,email:'invalid'},{...original,phone:'1'},{...original,zip:'bad'},{...original,address:''},{...original,firstName:'bad\nname'}])assert.throws(()=>parseCustomerChange({...good,customer}));
    const operation={requestId:'12345678-1234-4234-8234-123456789012',date:'2026-10-21',recordId:'2026-10-21:appointment:123',expectedVersion:'c'.repeat(64),action:'customer',values:good};assert.equal(parseScheduleOperation(operation).action,'customer');assert.throws(()=>parseScheduleOperation({...operation,values:{}}));
    console.log('Customer source fixture passed: verified save, blank email, lost response read-back, source conflict, changed unrelated fields, mismatched result, one-save maximum and validation. No live writes.');
  }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
void main();
