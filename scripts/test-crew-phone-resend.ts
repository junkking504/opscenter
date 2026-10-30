import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {requestCrewPhoneSetupChoice,crewPhoneSetupChoices} from '../lib/crew-phone-delivery';
import {enrollCrewPhone,crewPhone,revokeCrewPhone} from '../lib/crew-phone-store';

async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'resend-'));const previous={...process.env},originalFetch=globalThis.fetch;
 let sends=0,code='',mode='ok';let release:()=>void=()=>{};
 try{
 Object.assign(process.env,{OPS_CREW_PHONE_DIR:dir,OPS_CREW_PHONE_DELIVERY_APPROVAL:path.join(dir,'approval'),OPSCENTER_LOGIN_RATE_LIMIT_FILE:path.join(dir,'limits')});
 fs.writeFileSync(path.join(dir,'directory.json'),JSON.stringify({schema:1,company:Array.from({length:6},(_,i)=>({truck:`Truck ${i+1}`,label:`Fixture ${i}`,number:`504-555-010${i}`})),managers:[]}));
 const policy={schema:1,enabled:true,provider:'operations-linked',operationsAccount:'15045550199',purpose:'crew-phone-setup',approvedBy:'fixture',approvedAt:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString(),monthlyBudgetMicros:8370000,maxAttemptsPerMonth:837,reserveMicros:10000,template:'fixture',language:'en_US'};
 fs.writeFileSync(process.env.OPS_CREW_PHONE_DELIVERY_APPROVAL!,JSON.stringify(policy));
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/health'))return Response.json({status:'connected',account:'15045550199'});
  assert.equal(String(url),'http://127.0.0.1:18791/waypoint-code/send');sends++;code=JSON.parse(String(init?.body)).code;
  if(mode==='hold')await new Promise<void>(resolve=>{release=resolve;});
  if(mode==='lost')throw new Error('synthetic loss');
  return Response.json({success:true,messageId:'synthetic'});
 };
 const choices=crewPhoneSetupChoices(),key=()=>randomBytes(32).toString('hex');
 const request=(i:number,id=randomUUID())=>requestCrewPhoneSetupChoice(choices[i].id,id);
 const receipt=(id:string)=>JSON.parse(fs.readFileSync(path.join(dir,'deliveries',id+'.json'),'utf8'));
 // Three deliberate successive sends require no elapsed time; old values die.
 const first=randomUUID();await request(0,first);const oldCode=code;
 await request(0);const secondCode=code;assert.notEqual(secondCode,oldCode);
 assert.throws(()=>enrollCrewPhone(oldCode,key()),/replaced/);
 const activeKey=key(),active=enrollCrewPhone(secondCode,activeKey);
 await request(0);const thirdCode=code;
 assert.equal(crewPhone(activeKey)?.deviceId,active.deviceId,'Resend never disconnects an existing phone');
 assert.equal(enrollCrewPhone(secondCode,activeKey).deviceId,active.deviceId,'Lost enrollment response remains recoverable');
 assert.throws(()=>enrollCrewPhone(secondCode,key()),/already used/);
 const newestKey=key();enrollCrewPhone(thirdCode,newestKey);assert.throws(()=>enrollCrewPhone(thirdCode,key()),/already used/);
 const beforeCap=sends;await assert.rejects(request(0),/today/);assert.equal(sends,beforeCap);
 // Cancellation consumes its reservation but permits immediate replacement.
 const cancelled=randomUUID();await request(1,cancelled);const cancelledCode=code;revokeCrewPhone(receipt(cancelled).deviceId,'fixture');
 await request(1);assert.throws(()=>enrollCrewPhone(cancelledCode,key()),/removed/);enrollCrewPhone(code,key());
 // Expired codes remain invalid and can be deliberately replaced.
 const expired=randomUUID();await request(2,expired);const expiredCode=code;
 const row=receipt(expired);row.expiresAt=new Date(Date.now()-1).toISOString();fs.writeFileSync(path.join(dir,'deliveries',expired+'.json'),JSON.stringify(row));
 for(const name of fs.readdirSync(path.join(dir,'enrollments'))){const file=path.join(dir,'enrollments',name),e=JSON.parse(fs.readFileSync(file,'utf8'));if(e.deviceId===row.deviceId){e.expiresAt=row.expiresAt;fs.writeFileSync(file,JSON.stringify(e));}}
 assert.throws(()=>enrollCrewPhone(expiredCode,key()),/expired/);await request(2);enrollCrewPhone(code,key());
 // Pending, duplicate and uncertain results preserve identity and never replay.
 mode='hold';const pending=randomUUID(),running=request(3,pending);
 while(!fs.existsSync(path.join(dir,'deliveries',pending+'.json')))await new Promise(resolve=>setTimeout(resolve,1));
 const beforeDuplicate=sends;assert.equal((await request(3,pending)).canRequestNewCode,false);
 await assert.rejects(request(3),/not yet confirmed/);assert.equal(sends,beforeDuplicate);
 release();await running;mode='lost';const lost=randomUUID();await request(3,lost);const beforeLost=sends;
 assert.equal((await request(3,lost)).canRequestNewCode,false);await assert.rejects(request(3),/not yet confirmed/);assert.equal(sends,beforeLost);
 mode='ok';
 // A resend does not clear accumulated global guess failures; lockout persists.
 await request(4);const known=code;
 for(let i=0;i<8;i++)assert.throws(()=>enrollCrewPhone(known==='999999'?'999998':'999999',key()));
 await request(4);assert.throws(()=>enrollCrewPhone(code,key()),/Too many setup attempts/);
 const beforeMonthly=sends;fs.writeFileSync(process.env.OPS_CREW_PHONE_DELIVERY_APPROVAL!,JSON.stringify({...policy,maxAttemptsPerMonth:1}));
 await assert.rejects(request(5),/monthly/);assert.equal(sends,beforeMonthly);
 console.log('PASS immediate resend: successive/cancelled/expired, old-code invalidation, bound-session recovery, single use, shared guess lockout, duplicate/concurrent/uncertain no-replay and daily/monthly caps. All provider calls mocked.');
 }finally{globalThis.fetch=originalFetch;process.env=previous;fs.rmSync(dir,{recursive:true,force:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
