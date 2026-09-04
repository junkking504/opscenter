import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { desktopVersion, executeDesktopLocalAction, readDesktopKrewe, runDesktopKreweAction } from '../lib/desktop-krewe';
import { nullableNumber, sumObserved, validDesktopDate } from '../desktop-ui/lib/people-fleet-contract';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-people-fleet-'));
const previous=process.env.OPSCENTER_DESKTOP_PEOPLE_FLEET_DIR;process.env.OPSCENTER_DESKTOP_PEOPLE_FLEET_DIR=directory;
try {
 assert.equal(validDesktopDate('2026-02-30'),false);assert.equal(validDesktopDate('2026-09-04'),true);
 assert.equal(nullableNumber({rate:''},['rate']),null);assert.equal(nullableNumber({rate:0},['rate']),0);assert.equal(sumObserved([2,null]),null);assert.equal(sumObserved([]),null);assert.equal(sumObserved([2,3]),5);
 assert.throws(()=>readDesktopKrewe('2026-09-04','payperiod','operator'),/Manager access/);
 assert.throws(()=>runDesktopKreweAction({date:'2026-09-04',name:'Synthetic Test',action:'bonus'},'test@example.invalid','operator'),/role/);
 let state:unknown=null;let executions=0;const input={requestId:randomUUID(),action:'synthetic.local',entity:'test:synthetic',expectedVersion:desktopVersion(null),values:{amount:5}};
 const execute=()=>{executions++;state={amount:5};return state;};const verify=(result:unknown)=>desktopVersion(result)===desktopVersion(state);
 const first=executeDesktopLocalAction(input,'test@example.invalid',()=>state,execute,verify);assert.equal(first.status,'verified');
 const replay=executeDesktopLocalAction(input,'test@example.invalid',()=>state,execute,verify);assert.equal(replay.requestId,first.requestId);assert.equal(executions,1,'same request never executes twice');
 assert.throws(()=>executeDesktopLocalAction({...input,requestId:randomUUID()},'test@example.invalid',()=>state,execute,verify),/changed/);
 assert.throws(()=>executeDesktopLocalAction({...input,values:{amount:99}},'test@example.invalid',()=>state,execute,verify),/another operation/);
 assert.throws(()=>executeDesktopLocalAction(input,'other@example.invalid',()=>state,execute,verify),/another operation/);
 const uncertainInput={...input,requestId:randomUUID(),entity:'test:uncertain',expectedVersion:desktopVersion(state)};
 assert.equal(executeDesktopLocalAction(uncertainInput,'test@example.invalid',()=>state,()=>{throw new Error('synthetic failure');},verify).status,'uncertain');
 assert.throws(()=>executeDesktopLocalAction({...uncertainInput,requestId:randomUUID()},'test@example.invalid',()=>state,execute,verify),/unverified write/);
 const disk=JSON.parse(fs.readFileSync(path.join(directory,'receipts.json'),'utf8'));assert.equal(disk[0].actor,'test@example.invalid');assert.equal(disk[1].status,'uncertain');
 console.log('Desktop people/fleet contract tests passed: dates, null evidence, payroll roles, durable read-back, versions, replay, actor and uncertain-write guards.');
}finally{fs.rmSync(directory,{recursive:true,force:true});if(previous===undefined)delete process.env.OPSCENTER_DESKTOP_PEOPLE_FLEET_DIR;else process.env.OPSCENTER_DESKTOP_PEOPLE_FLEET_DIR=previous;}
