import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createCrewPhoneEnrollment,enrollCrewPhone,revokeCrewPhone} from '../lib/crew-phone-store';
import {saveCrewDay} from '../lib/crew-phone-day';import {activeNotificationPhone,waypointNotificationOwner} from '../lib/waypoint-push';import {chicagoDateKey} from '../lib/chicago-date';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'waypoint-phone-test-')),prior={...process.env};
try{
 process.env.OPS_CREW_PHONE_DIR=root;process.env.OPSCENTER_LOGIN_RATE_LIMIT_FILE=path.join(root,'rate-limit');process.env.OPS_CREW_ROSTER_JSON='[]';process.env.OPS_WAYPOINT_CREW_EXTRA_NAMES_JSON='["Synthetic Crew"]';
 const invite=createCrewPhoneEnrollment('Truck 1','Synthetic phone','synthetic-manager'),phone=enrollCrewPhone(invite.code,'a'.repeat(64));
 assert.equal(activeNotificationPhone(phone.deviceId),null,'Daily crew setup required');
 const body={date:chicagoDateKey(),requestId:randomUUID(),expectedVersion:0,driver:'Synthetic Crew',responsible:'Synthetic Crew',navigators:[]};saveCrewDay(phone,body,new Date(),['Synthetic Crew']);
 assert.equal(activeNotificationPhone(phone.deviceId,'Truck 1')?.deviceId,phone.deviceId);
 const identity=waypointNotificationOwner('a'.repeat(64));assert.match(identity,/^[a-f0-9]{64}$/);
 saveCrewDay(phone,{...body,requestId:randomUUID(),expectedVersion:1,truck:'Truck 2'},new Date(),['Synthetic Crew']);
 assert.equal(activeNotificationPhone(phone.deviceId,'Truck 1'),null,'Old truck denied');assert.equal(activeNotificationPhone(phone.deviceId,'Truck 2')?.truck,'Truck 2');
 process.env.OPS_WAYPOINT_CREW_EXTRA_NAMES_JSON='[]';assert.equal(activeNotificationPhone(phone.deviceId),null,'Changed roster fails closed');process.env.OPS_WAYPOINT_CREW_EXTRA_NAMES_JSON='["Synthetic Crew"]';
 revokeCrewPhone(phone.deviceId,'synthetic-manager');assert.equal(activeNotificationPhone(phone.deviceId),null,'Revoked phone denied');
 console.log('PASS real isolated phone bindings: daily setup, stable owner, current truck, crew roster and revocation checks.');
}finally{process.env=prior;fs.rmSync(root,{recursive:true,force:true});}
