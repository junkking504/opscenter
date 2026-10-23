import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { crewCanBrowseAllTrucks } from '../lib/crew-appointment-visibility';
import { createCrewPhoneEnrollment, enrollCrewPhone, revokeCrewPhone } from '../lib/crew-phone-store';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'waypoint-read-policy-'));
process.env.OPS_CREW_PHONE_DIR=dir;
process.env.OPSCENTER_LOGIN_RATE_LIMIT_FILE=path.join(dir,'attempts.json');
const write=(name:string,value:unknown)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
const actor=(number:string)=>`crew-self-setup:${createHash('sha256').update(number.replace(/-/g,'')).digest('hex')}`;
const contacts=[
 {kind:'manager',name:'Fixture Manager One',number:'225-555-0101'},
 {kind:'manager',name:'Fixture Manager Two',number:'225-555-0102'},
 {kind:'manager',name:'Fixture Manager Three',number:'225-555-0103'},
 {kind:'company',name:'Fixture Operations',number:'225-555-0104'},
];
const directory={schema:1,managers:contacts.slice(0,3).map(({name,number})=>({name,number})),company:[{label:contacts[3].name,number:contacts[3].number,truck:'Truck 2'}]};
const approval={schema:1,purpose:'waypoint-manager',approvedBy:'fixture-owner',approvedAt:new Date(Date.now()-1000).toISOString(),contacts};
function phone(number:string,label='Not an authority',test=false){const invitation=createCrewPhoneEnrollment('Truck 1',label,actor(number),new Date(),test);return enrollCrewPhone(invitation.code,randomBytes(32).toString('hex'));}
try {
 write('directory.json',directory);
 const enrolled=contacts.map(contact=>phone(contact.number));
 assert.equal(crewCanBrowseAllTrucks(enrolled[0]),false,'Unapproved code deployment grants nothing');
 write('manager-access.json',approval);
 for(const p of enrolled){assert.equal(crewCanBrowseAllTrucks(p),true);assert.equal(crewCanBrowseAllTrucks({...p,truck:'Truck 9',label:'Changed label'}),true,'Daily truck and display label never select authority');}
 const ordinary=phone('225-555-0199','Fixture Operations');
 assert.equal(crewCanBrowseAllTrucks(ordinary),false,'Exact label match on another identity is not authority');
 assert.equal(crewCanBrowseAllTrucks({...ordinary,deviceId:enrolled[0].deviceId}),false,'Binding enrollment must match');
 assert.equal(crewCanBrowseAllTrucks({...enrolled[0],test:true}),false,'Sandbox never sees live appointments');
 assert.equal(crewCanBrowseAllTrucks(enrolled[0],new Date(Date.now()+86400_000)),false,'Daily enrollment expiry remains required');
 write('directory.json',{...directory,managers:[...directory.managers,{name:'Other person',number:contacts[0].number}]});
 assert.equal(crewCanBrowseAllTrucks(enrolled[0]),false,'Ambiguous number fails closed');
 write('directory.json',{...directory,managers:directory.managers.map((row,i)=>i===0?{...row,name:'Different person'}:row)});
 assert.equal(crewCanBrowseAllTrucks(enrolled[0]),false,'Directory reassignment does not inherit approval');
 write('directory.json',directory);
 for(const invalid of [{...approval,contacts:[...contacts,contacts[0]]},{...approval,purpose:'manager'},{...approval,approvedAt:'bad'},{...approval,approvedAt:new Date(Date.now()+60_000).toISOString()},{...approval,approvedBy:''},{...approval,contacts:[]}]){
  write('manager-access.json',invalid);assert.equal(crewCanBrowseAllTrucks(enrolled[0]),false);
 }
 write('manager-access.json',approval);
 revokeCrewPhone(enrolled[0].deviceId,'fixture-owner');assert.equal(crewCanBrowseAllTrucks(enrolled[0]),false,'Revocation wins');
 fs.writeFileSync(path.join(dir,'manager-access.json'),'{broken');assert.equal(crewCanBrowseAllTrucks(enrolled[1]),false);
 console.log('PASS: four exact phone identities, missing/malformed approval, label spoof, sandbox, expiry, revocation, duplicate/reassigned directory contacts; isolated files only.');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
