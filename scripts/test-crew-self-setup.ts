import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {crewPhoneSession} from '../lib/crew-phone-http';
import {requestCrewPhoneSetup,crewPhoneDeliveryHealth} from '../lib/crew-phone-delivery';
import {enrollCrewPhone} from '../lib/crew-phone-store';

async function main(){
  const previous={...process.env},originalFetch=globalThis.fetch;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crew-self-setup-'));
  let calls=0,code='',expectedTo='15045550100';
  try {
    process.env.OPS_CREW_PHONE_DIR=dir;process.env.OPS_CREW_PHONE_DELIVERY_APPROVAL=path.join(dir,'approval');
    process.env.OPSCENTER_LOGIN_RATE_LIMIT_FILE=path.join(dir,'limits');
    process.env.WHATSAPP_ACCESS_TOKEN='synthetic';delete process.env.WHATSAPP_ACCESS_TOKEN_BASE64;
    process.env.WHATSAPP_PHONE_NUMBER_ID='123';process.env.WHATSAPP_GRAPH_API_VERSION='v24.0';
    const policy={schema:1,enabled:true,provider:'meta-whatsapp',purpose:'crew-phone-setup',approvedBy:'synthetic',approvedAt:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString(),monthlyBudgetMicros:1000000,maxAttemptsPerMonth:100,reserveMicros:10000,template:'synthetic_setup',language:'en_US'};
    fs.writeFileSync(process.env.OPS_CREW_PHONE_DELIVERY_APPROVAL,JSON.stringify(policy));
    fs.writeFileSync(path.join(dir,'directory.json'),JSON.stringify({schema:1,company:[{truck:'Truck 6',label:'Synthetic phone',number:'504-555-0100'}],managers:[{name:'Synthetic manager',number:'504-555-0199'}]}));
    globalThis.fetch=async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.equal(body.to,expectedTo);code=body.template.components[0].parameters[0].text;return Response.json({messages:[{id:'synthetic'}]});};
    const request=(body:unknown,origin='https://waypoint.junk-king.app')=>new Request('https://waypoint.junk-king.app/api/crew-jobs/session',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const requestId=randomUUID();
    assert.equal((await crewPhoneSession(request({action:'request-code',number:'5045550100',requestId},'https://evil.invalid'))).status,403);
    assert.equal(calls,0);
    await assert.rejects(requestCrewPhoneSetup('504-555-0111',randomUUID()),/No code was sent/);
    await assert.rejects(requestCrewPhoneSetup('504-555-0199',randomUUID()),/No code was sent/);assert.equal(calls,0,'Unknown and unapproved manager numbers are not eligible');
    const response=await crewPhoneSession(request({action:'request-code',number:'+1 (504) 555-0100',requestId}));
    assert.equal(response.status,200);const reply=await response.json();assert.deepEqual(Object.keys(reply),['message']);assert.match(reply.message,/WhatsApp accepted/);assert(!reply.message.includes(code),'Public reply must not return a code');assert.equal(calls,1);
    const recovered=await crewPhoneSession(request({action:'request-code',number:'5045550100',requestId}));
    assert.equal(recovered.status,200);assert.equal(calls,1,'Same saved send is returned without replay');
    assert.equal(enrollCrewPhone(code,randomBytes(32).toString('hex')).truck,'Truck 6');
    await assert.rejects(requestCrewPhoneSetup('5045550100',randomUUID()),/already requested/);
    const receipts=path.join(dir,'deliveries');
    const original=JSON.parse(fs.readFileSync(path.join(receipts,`${requestId}.json`),'utf8'));
    for(let i=0;i<3;i++) {const row={...original,requestId:i===0?requestId:randomUUID(),createdAt:new Date(Date.now()-(20+i)*60_000).toISOString()};fs.writeFileSync(path.join(receipts,`${row.requestId}.json`),JSON.stringify(row));}
    await assert.rejects(requestCrewPhoneSetup('5045550100',randomUUID()),/today/);assert.equal(calls,1);
    const uncertain={...original,status:'uncertain'};fs.writeFileSync(path.join(receipts,`${requestId}.json`),JSON.stringify(uncertain));
    assert.equal(crewPhoneDeliveryHealth().exceptions.length,1);
    const check=await requestCrewPhoneSetup('5045550100',requestId);assert.match(check.message,/not yet confirmed/);assert.equal(calls,1);
    fs.writeFileSync(process.env.OPS_CREW_PHONE_DELIVERY_APPROVAL,JSON.stringify({...policy,enabled:false}));
    assert.equal(crewPhoneDeliveryHealth().ready,false);assert.equal(crewPhoneDeliveryHealth().exceptions.length,1,'Missing approval must not hide unresolved sends');
    assert.match((await requestCrewPhoneSetup('5045550100',requestId)).message,/not yet confirmed/,'Existing receipt remains recoverable');
    for(let i=0;i<9;i++)await crewPhoneSession(request({action:'request-code',number:'5045550111',requestId:randomUUID()}));
    assert.equal((await crewPhoneSession(request({action:'request-code',number:'5045550111',requestId:randomUUID()}))).status,429);
    assert.equal(calls,1);
    expectedTo='15045550199';
    fs.writeFileSync(process.env.OPS_CREW_PHONE_DELIVERY_APPROVAL,JSON.stringify({...policy,selfSetupTestRecipientName:'Synthetic manager'}));
    const testId=randomUUID();
    const test=await requestCrewPhoneSetup('5045550199',testId);assert.match(test.message,/WhatsApp accepted/);assert.equal(calls,2);
    assert.match((await requestCrewPhoneSetup('5045550199',testId)).message,/WhatsApp accepted/);assert.equal(calls,2,'Test send also recovers without replay');
    assert.equal(enrollCrewPhone(code,randomBytes(32).toString('hex')).truck,'Truck 6');
    await assert.rejects(requestCrewPhoneSetup('5045550199',randomUUID()),/already requested/);assert.equal(calls,2);
    const testFile=path.join(receipts,`${testId}.json`),testReceipt=JSON.parse(fs.readFileSync(testFile,'utf8'));
    fs.writeFileSync(testFile,JSON.stringify({...testReceipt,expiresAt:new Date(Date.now()-1000).toISOString()}));
    await assert.rejects(requestCrewPhoneSetup('5045550199',testId),/expired/);assert.equal(calls,2,'Expired status must not pretend a new code was sent');
    fs.writeFileSync(testFile,JSON.stringify({...testReceipt,status:'uncertain'}));
    assert.equal(crewPhoneDeliveryHealth().exceptions.length,2,'Explicit test-phone failures are monitored');
    fs.writeFileSync(process.env.OPS_CREW_PHONE_DELIVERY_APPROVAL,JSON.stringify(policy));
    await assert.rejects(requestCrewPhoneSetup('5045550199',randomUUID()),/No code was sent/);assert.equal(calls,2,'Removing test permission immediately stops new sends');
    console.log('Self setup passed: same-origin boundary, registered-number routing, clear no-send response, approved test phone, real enrollment from mocked message, saved-send recovery, uncertain no replay, phone/day and address limits, unchanged approval gate and delivery monitoring.');
  }finally{globalThis.fetch=originalFetch;process.env=previous;fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
