import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { capture, applyCloseout } from './sync-junkware-job-closeout';
import { captureCloseoutSource } from './junkware-closeout-source';
import { verifyCloseoutFields, closeoutSourceVersion } from '../lib/desktop-closeout-contract';
import { validateCloseoutPayment } from '../lib/closeout-payment';
import { saveAndVerifyCloseout } from '../lib/closeout-save-verification';

const methods = [{value:'1',label:'Billed'}, {value:'2',label:'Cash'}, {value:'3',label:'Credit Card'}, {value:'4',label:'Check'}];
const input = { appointmentType:'Job', driverId:'d', navigatorIds:[] as string[], loadQuantity:'1',loadSize:'',loadPrice:'1200.00',bedloadQuantity:'',bedloadSize:'',bedloadPrice:'',otherChargesToAdd:[],discount:'',tip:'',jobCategoryId:'',actualStartHour:'12',actualStartMinute:'00',actualEndHour:'13',actualEndMinute:'00' };
type Payment = {description:string;amount:string};
let persisted = new URLSearchParams(), payments:Payment[] = [], pending:Payment[] = [], saves = 0, adds = 0;
const esc = (s:string) => s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
function html(fields:URLSearchParams) {
  const value = (key:string) => fields.get(`ctl00$Content$${key}`) || '';
  const control = (key:string) => `<input id="ctl00_Content_${key}" name="ctl00$Content$${key}" value="${esc(value(key))}">`;
  const select = (key:string, options:{value:string;label:string}[]) => `<select id="ctl00_Content_${key}" name="ctl00$Content$${key}">${options.map(o=>`<option value="${o.value}" ${value(key)===o.value?'selected':''}>${o.label}</option>`).join('')}</select>`;
  const submit = (key:string) => `<input type="submit" id="ctl00_Content_${key}" name="ctl00$Content$${key}" value="${key}">`;
  const status = value('StatusDD');
  return `<!doctype html><html><body>JKTEST1234<form method="post"><input name="__EVENTTARGET"><input name="__EVENTARGUMENT">
  ${select('StatusDD',[{value:'1',label:'Confirmed'},{value:'8',label:'Completed'}])}
  ${select('AppointmentTypeDD',[{value:'2',label:'Job'},{value:'1',label:'Estimate'}])}
  ${select('TruckDD',[{value:'t',label:'Truck 1'}])}
  ${select('DriverDD',[{value:'d',label:'Synthetic Driver'}])}
  ${select('AppointmentTechniciansLV_ctrl0_NavigatorDD',[{value:'',label:''}])}
  ${['LoadSizeTruckQtyTB','BillingAmountTB','BedloadTruckQtyTB','BedLoadPriceTB','DiscountsTB','TipsTB'].map(control).join('')}
  ${['LoadSizeDD','BedloadDD','JobCategoryDD','OtherChargeDD'].map(k=>select(k,[{value:'',label:''}])).join('')}
  ${['ActualStartHourDD','ActualEndHourDD'].map(k=>select(k,[{value:'',label:''},{value:'12',label:'12 PM'},{value:'13',label:'01 PM'}])).join('')}
  ${['ActualStartMinuteDD','ActualEndMinuteDD'].map(k=>select(k,[{value:'',label:''},{value:'00',label:'00'}])).join('')}
  <span id="ctl00_Content_TotalLbl">$1,200.00</span>
  ${status==='8'?`${select('PaymentMethodDD',[{value:'',label:''},...methods])}${['3','4'].includes(value('PaymentMethodDD'))?control('PaymentDescrTB'):''}${control('PaymentAmountTB')}${submit('AddPaymentBtn')}<input id="ctl00_Content_BalanceOwedHF" value="${1200-pending.reduce((s,p)=>s+Number(p.amount),0)}"><table>${pending.map((p,i)=>`<tr id="ctl00_Content_PaymentsLV_ctrl${i}_ItemRow"><td>${esc(p.description)}</td><td>${p.amount}</td></tr>`).join('')}</table>`:''}
  <input id="ctl00_Content_LoadSizeHF" name="ctl00$Content$LoadSizeHF" value="${value('LoadSizeHF')}">
  ${submit('SaveAppointmentBtn')}</form><script>document.getElementById('ctl00_Content_LoadSizeDD').addEventListener('change',()=>{ document.getElementById('ctl00_Content_LoadSizeHF').value=document.getElementById('ctl00_Content_LoadSizeTruckQtyTB').value;document.getElementById('ctl00_Content_BillingAmountTB').value='999'; });</script></body></html>`;
}
async function main() {
  const server = createServer(async(req,res)=>{
    let body='';for await(const part of req) body+=part;
    const fields=req.method==='POST'?new URLSearchParams(body):new URLSearchParams(persisted);
    if(req.method==='GET') pending=payments.map(p=>({...p}));
    if(req.method==='POST' && fields.has('ctl00$Content$AddPaymentBtn')) {
      adds++;
      const id=fields.get('ctl00$Content$PaymentMethodDD')!, reference=fields.get('ctl00$Content$PaymentDescrTB') || '';
      pending.push({description:methods.find(m=>m.value===id)!.label+(reference?`, ${id==='4'?'#':'***'}${reference}`:''),amount:fields.get('ctl00$Content$PaymentAmountTB')!});
    }
    if(req.method==='POST' && fields.has('ctl00$Content$SaveAppointmentBtn')) { saves++;persisted=new URLSearchParams(fields);payments=pending.map(p=>({...p})); }
    res.setHeader('Content-Type','text/html');res.end(html(fields));
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/appointment.aspx`;
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    for(const method of methods) {
      persisted=new URLSearchParams({'ctl00$Content$StatusDD':'1','ctl00$Content$AppointmentTypeDD':'2','ctl00$Content$LoadSizeTruckQtyTB':'1','ctl00$Content$BillingAmountTB':'1200.00'});
      payments=[{description:'Cash',amount:'100.00'}];adds=0;saves=0;
      await page.goto(url);
      const before=await captureCloseoutSource(page,capture);
      assert.equal(before.status.value,'1');assert.equal((await capture(page)).status.value,'1');
      assert.equal((before.paymentMethods as unknown[]).length,5);assert.equal(before.balance,'1100');assert.deepEqual(before.payments,payments);
      assert.equal(adds,0);assert.equal(saves,0,'Reading options must not save');
      const again=await captureCloseoutSource(page,capture);assert.equal(closeoutSourceVersion(before),closeoutSourceVersion(again));
      const addPayment={methodId:method.value,amount:'1100.00',reference:method.value==='4'?'009924':method.value==='3'?'6004':''};
      assert.equal(validateCloseoutPayment(addPayment,methods),'');
      const request={...input,addPayment};
      const result=await saveAndVerifyCloseout(before,()=>applyCloseout(page,request,before),async()=>{await page.goto(url);return captureCloseoutSource(page,capture);},result=>verifyCloseoutFields(result,request,before));
      assert.equal(persisted.get('ctl00$Content$LoadSizeHF'),'1');assert.equal(result.status.value,'8');assert.equal((result.driver as {value:string}).value,'d');assert.equal(saves,1);assert.equal(adds,1);assert.equal((result.payments as unknown[]).length,2);
      if(addPayment.reference) assert.throws(()=>verifyCloseoutFields(result,{...request,addPayment:{...addPayment,reference:'9999'}},before),/reference/);
      assert.throws(()=>verifyCloseoutFields({...result,payments:[...payments,payments[1]]},request,before),/payment amount/);
    }
    for(const amount of ['','0','-1','NaN','1.001','1000001']) assert.ok(validateCloseoutPayment({methodId:'2',amount},methods));
    assert.ok(validateCloseoutPayment({methodId:'unknown',amount:'1'},methods));
    assert.ok(validateCloseoutPayment({methodId:'3',amount:'1',reference:'1234567890123456'},methods));
    assert.ok(validateCloseoutPayment({methodId:'4',amount:'1'},methods));
    console.log('Closeout payment browser fixtures passed: unsaved option discovery, stable source baseline, existing payments, Billed/Cash/Card/Check save and fresh read-back, references, duplicate rejection, and invalid input. No live writes.');
  } finally {await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
}
void main();
