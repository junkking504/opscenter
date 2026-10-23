import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {crewPhoneSetupChoices,requestCrewPhoneSetupChoice} from '../lib/crew-phone-delivery';
import {enrollCrewPhone} from '../lib/crew-phone-store';
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'operations-code-'));
 const previous={...process.env},originalFetch=globalThis.fetch;
 let sends=0,code='',mode='ok';
 try{
 process.env.HOME=dir;process.env.OPS_CREW_PHONE_DIR=path.join(dir,'phones');process.env.OPS_CREW_PHONE_DELIVERY_APPROVAL=path.join(dir,'approval.json');
 fs.mkdirSync(process.env.OPS_CREW_PHONE_DIR,{recursive:true});
 fs.writeFileSync(path.join(process.env.OPS_CREW_PHONE_DIR,'directory.json'),JSON.stringify({schema:1,company:[{truck:'Truck 1',label:'Synthetic phone',number:'504-555-0100'}],managers:[]}));
 fs.writeFileSync(process.env.OPS_CREW_PHONE_DELIVERY_APPROVAL,JSON.stringify({schema:1,enabled:true,provider:'operations-linked',operationsAccount:'15045550199',purpose:'crew-phone-setup',approvedBy:'Synthetic',approvedAt:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+3600000).toISOString(),monthlyBudgetMicros:8370000,maxAttemptsPerMonth:837,reserveMicros:10000,template:'unused_template',language:'en_US'}));
 globalThis.fetch=async (url,init)=>{
 assert.ok(String(url).startsWith('http://127.0.0.1:18791/'),'No Meta or external requests');
 if(String(url).endsWith('/health'))return Response.json({status:mode==='offline'?'disconnected':'connected',account:mode==='wrong-account'?'15045550198':'15045550199'});
 sends++;const body=JSON.parse(String(init?.body));assert.equal(body.to,'15045550100@s.whatsapp.net');assert.equal(body.account,'15045550199');code=body.code;assert.match(code,/^\d{6}$/);
 if(mode==='uncertain')throw new Error('lost response');
 return Response.json({success:true,messageId:'synthetic-operation-id'});
 };
 const choice=crewPhoneSetupChoices()[0].id,id=randomUUID();
 mode='wrong-account';
 await assert.rejects(requestCrewPhoneSetupChoice(choice,id),/Operations WhatsApp is unavailable/);assert.equal(sends,0);
 mode='offline';await assert.rejects(requestCrewPhoneSetupChoice(choice,id),/Operations WhatsApp is unavailable/);assert.equal(sends,0);
 mode='ok';const publicResult=await requestCrewPhoneSetupChoice(choice,id);assert.ok(!JSON.stringify(publicResult).includes(code));assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.OPS_CREW_PHONE_DIR,'deliveries',id+'.json'),'utf8')).providerMessageId,'synthetic-operation-id');await requestCrewPhoneSetupChoice(choice,id);assert.equal(sends,1);
 assert.ok(!fs.readFileSync(path.join(process.env.OPS_CREW_PHONE_DIR,'deliveries',id+'.json'),'utf8').includes(code),'Receipt never contains code');
 const enrolled=enrollCrewPhone(code,'a'.repeat(64));assert.ok(enrolled.deviceId);
 await assert.rejects(requestCrewPhoneSetupChoice(choice,randomUUID()),/already requested/);
 // A fresh isolated ledger exercises response loss and durable no-replay.
 fs.renameSync(path.join(process.env.OPS_CREW_PHONE_DIR,'deliveries'),path.join(dir,'prior-deliveries'));
 mode='uncertain';const uncertain=randomUUID();await requestCrewPhoneSetupChoice(choice,uncertain);await requestCrewPhoneSetupChoice(choice,uncertain);assert.equal(sends,2);
 assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.OPS_CREW_PHONE_DIR,'deliveries',uncertain+'.json'),'utf8')).status,'uncertain');
 console.log('PASS Operations codes: fixed direct recipient, offline denial, enrollment, no plaintext receipts, cooldown, accepted/uncertain no-replay; no live sends.');
 }finally{globalThis.fetch=originalFetch;process.env=previous;fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
