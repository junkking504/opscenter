import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {waypointChecks,waypointRouteFeeds,waypointLedgerFeeds,waypointDeliveryFeed} from '../lib/waypoint-agent';
import {projectHierarchy} from '../lib/agent-hierarchy';
import {hierarchyAgents,hierarchyTabs} from '../desktop-ui/lib/agent-hierarchy-contract';

async function main(){
  const now=Date.parse('2026-09-19T17:00:00Z'),date='2026-09-19';
  const at=new Date(now).toISOString(),old=new Date(now-11*60_000).toISOString();
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'waypoint-agent-'));
  const switchId='10000000-0000-4000-8000-000000000001',receiptId='10000000-0000-4000-8000-000000000002';
  const put=(directory:string,id:string,value:unknown)=>{const dir=path.join(root,directory);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,`${id}.json`),JSON.stringify(value));};
  const good=async(route:string)=>route==='/crew-jobs'?{status:200,body:'Waypoint waypoint-favicon'}:route.endsWith('webmanifest')?{status:200,body:JSON.stringify({name:'Waypoint',start_url:'/crew-jobs'})}:{status:401,body:JSON.stringify({error:'This phone needs manager setup.'})};
  try {
    assert.equal(waypointDeliveryFeed(now,()=>({ready:false,reason:'Fixture approval expired',exceptions:[]})).findings[0].origin,'waypoint');
    assert.equal(waypointDeliveryFeed(now,()=>{throw new Error('fixture corrupt');}).available,false);
    assert.equal(hierarchyAgents.find(a=>a.id==='waypoint')?.parent,'engineering');
    assert.equal(hierarchyTabs.filter(t=>t.page==='Waypoint' && t.owner==='waypoint').length,5);
    const healthy=await waypointRouteFeeds(now,good);
    assert(healthy.every(f=>f.available && !f.findings.length));
    assert(healthy.every(f=>/in \d+ms/.test(f.detail)),'Route timing is retained in every probe result');
    assert.equal(healthy.length,8);
    let active=0,maximum=0;
    await waypointRouteFeeds(now,async route=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return good(route);});
    assert.equal(maximum,4,'Loopback probes use four bounded lanes');
    for(const check of waypointChecks){
      const bad=await waypointRouteFeeds(now,async route=>route===check.route?{status:200,body:'Sign in'}:good(route));
      assert.equal(bad.flatMap(f=>f.findings).length,1,'Login/wrong-page response cannot pass');
      assert.equal(bad.flatMap(f=>f.findings)[0].origin,'waypoint');
    }
    const denied=await waypointRouteFeeds(now,async()=>({status:302,body:''}));
    assert(denied.every(f=>f.findings.length===1),'Redirects do not certify an API boundary');
    const offline=await waypointRouteFeeds(now,async()=>{throw new Error('fixture outage');});
    assert(offline.every(f=>!f.available && f.findings[0].origin==='waypoint'));
    const stateFile=path.join(root,'agent-hierarchy','waypoint-probes.json');
    const transient=await waypointRouteFeeds(now,async()=>{throw new Error('Check timed out after 3000ms');},stateFile);
    assert(transient.every(f=>f.available&&!f.findings.length&&f.detail.includes('(1/2)')),'One transient route failure does not declare an outage');
    const repeated=await waypointRouteFeeds(now+60_000,async()=>{const error=new Error('connect refused') as NodeJS.ErrnoException;error.code='ECONNREFUSED';throw error;},stateFile);
    assert(repeated.every(f=>!f.available&&f.detail.includes('connection_refused')),'Two consecutive failures declare a classified outage');
    await waypointRouteFeeds(now+120_000,good,stateFile);
    const afterRecovery=await waypointRouteFeeds(now+180_000,async()=>{throw new Error('fixture outage');},stateFile);
    assert(afterRecovery.every(f=>f.available&&!f.findings.length),'A verified success resets the consecutive-failure counter');
    assert(waypointLedgerFeeds(root,now).every(f=>f.available && !f.findings.length),'Unused ledgers are allowed');
    put('crew-phones/truck-switches',switchId,{schema:1,requestId:switchId,status:'moving',updatedAt:at});
    put('desktop-operations',receiptId,{requestId:receiptId,action:'closeout',actor:'crew-phone:fixture',status:'pending',updatedAt:at});
    assert(!waypointLedgerFeeds(root,now).some(f=>f.findings.length),'In-progress work has a grace period');
    put('crew-phones/truck-switches',switchId,{schema:1,requestId:switchId,status:'attention',updatedAt:at});
    put('desktop-operations',receiptId,{requestId:receiptId,action:'closeout',actor:'crew-phone:fixture',status:'pending',updatedAt:old});
    const before=fs.readFileSync(path.join(root,'desktop-operations',`${receiptId}.json`),'utf8');
    const stalled=waypointLedgerFeeds(root,now);
    assert.equal(stalled.flatMap(f=>f.findings).length,2);
    assert.equal(fs.readFileSync(path.join(root,'desktop-operations',`${receiptId}.json`),'utf8'),before,'Monitoring cannot rewrite receipts');
    const snapshot=projectHierarchy(date,[...healthy,...stalled],now);
    assert(snapshot.issues.every(i=>i.owner==='waypoint' && i.status==='open'));
    const overdue=projectHierarchy(date,[...healthy,...stalled],now+16*60_000,snapshot);
    assert(overdue.issues.every(i=>i.escalatedTo==='engineering'));
    fs.writeFileSync(path.join(root,'desktop-operations',`${receiptId}.json`),'{');
    const damaged=waypointLedgerFeeds(root,now);
    const retained=projectHierarchy(date,[...healthy,...damaged],now+17*60_000,overdue);
    assert.equal(retained.issues.find(i=>i.id===`waypoint:closeouts:${receiptId}`)?.status,'unconfirmed');
    put('crew-phones/truck-switches',switchId,{schema:1,requestId:switchId,status:'complete',updatedAt:at});
    put('desktop-operations',receiptId,{requestId:receiptId,action:'closeout',actor:'crew-phone:fixture',status:'verified',updatedAt:at});
    const cleared=projectHierarchy(date,[...healthy,...waypointLedgerFeeds(root,now)],now+18*60_000,retained);
    assert(cleared.issues.every(i=>i.status==='source_cleared'));
    put('desktop-operations',receiptId,{requestId:receiptId,action:'closeout',actor:'manager:fixture',status:'uncertain',updatedAt:old});
    assert.equal(waypointLedgerFeeds(root,now)[1].findings.length,0,'Manager closeouts retain their existing ownership');
    put('crew-phones/truck-switches',switchId,{schema:1,requestId:switchId,status:'moving',updatedAt:old});
    assert.equal(waypointLedgerFeeds(root,now)[0].findings.length,1,'Abandoned moving switch is visible');
    assert(waypointLedgerFeeds(path.join(root,'missing'),now).every(f=>!f.available),'Missing data mount cannot clear findings');
    console.log('Waypoint agent passed: five owned crew flows, eight bounded route contracts, stalled switch/closeout detection, read-only receipts, Engineering escalation, damaged evidence retention and verified-source clearance.');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
