import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {hierarchyAgents,hierarchyTabs,type HierarchyFeed,type HierarchyFinding,type HierarchySnapshot} from '../desktop-ui/lib/agent-hierarchy-contract';
import {projectHierarchy,saveHierarchy,readHierarchy} from '../lib/agent-hierarchy';
import {requiredOpsPermission} from '../lib/ops-roles';
const now=Date.parse('2026-09-17T15:00:00Z'),date='2026-09-17',at=new Date(now).toISOString();
assert.equal(hierarchyTabs.length,32);assert.equal(new Set(hierarchyTabs.map(t=>`${t.page}:${t.tab}`)).size,32);
assert.equal(new Set(hierarchyAgents.map(a=>a.id)).size,hierarchyAgents.length);
for(const a of hierarchyAgents){const visited=new Set<string>();let id:string|null=a.id;while(id){assert(!visited.has(id),'No hierarchy cycles');visited.add(id);const row=hierarchyAgents.find(x=>x.id===id);assert(row,'Parent exists');id=row.parent;}}
for(const tab of hierarchyTabs)assert(hierarchyAgents.some(a=>a.id===tab.owner));
const dependencies=[...new Set(hierarchyAgents.flatMap(a=>a.dependencies))];
const feeds:HierarchyFeed[]=dependencies.map(id=>({id,available:true,observedAt:at,detail:'Fixture',findings:[]}));
const finding:HierarchyFinding={id:'truck-6:fixture:receipt:1',feed:'truck-assessments',title:'Receipt ambiguity',detail:'Fixture',href:'/desktop',origin:'truck-6',target:'expenses',priority:'urgent'};
feeds.find(f=>f.id===finding.feed)!.findings=[finding];
const broken=structuredClone(feeds);broken.find(f=>f.id==='unload-cost')!.available=false;
const pending=projectHierarchy(date,broken,now);
assert.equal(pending.issues[0].owner,'truck-6');assert.equal(pending.issues[0].proposedOwner,'expenses');
const accepted=projectHierarchy(date,feeds,now+1000,pending);
assert.equal(accepted.issues[0].owner,'expenses');assert.equal(accepted.issues[0].proposedOwner,null);assert.equal(accepted.issues[0].history.filter(h=>h.event==='accepted').length,1);
const repeated=projectHierarchy(date,feeds,now+2000,accepted);assert.equal(repeated.issues[0].history.length,accepted.issues[0].history.length,'No duplicate handoff on unchanged evidence');
const overdue=projectHierarchy(date,feeds,now+16*60_000,repeated);assert.equal(overdue.issues[0].escalatedTo,'capital');
const unavailable=structuredClone(feeds);unavailable.find(f=>f.id===finding.feed)!.available=false;unavailable.find(f=>f.id===finding.feed)!.findings=[];
const retained=projectHierarchy(date,unavailable,now+17*60_000,overdue);assert.equal(retained.issues[0].owner,'expenses');assert.equal(retained.issues[0].status,'unconfirmed');
const clear=structuredClone(feeds);clear.find(f=>f.id===finding.feed)!.findings=[];
const cleared=projectHierarchy(date,clear,now+18*60_000,retained);assert.equal(cleared.issues[0].status,'source_cleared');
const reopened=projectHierarchy(date,feeds,now+19*60_000,cleared);assert.equal(reopened.issues[0].status,'open');assert.equal(reopened.issues[0].escalatedTo,null,'Reappearing condition gets a new review deadline');
assert.equal(projectHierarchy(date,feeds,now,reopened).checkedAt,reopened.checkedAt,'Clock rollback cannot overwrite state');
assert.equal(requiredOpsPermission('/api/desktop/agent-hierarchy','GET').requiredRole,'manager');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-hierarchy-'));process.env.OPSCENTER_DATA_DIR=root;
try {
  assert.equal(readHierarchy(now),null);assert.throws(()=>saveHierarchy(accepted),/lock/);
  process.env.OPSCENTER_AGENT_LOCK_HELD='1';saveHierarchy(accepted);
  assert.equal(readHierarchy(now+1000)!.issues[0].owner,'expenses');assert.equal(fs.statSync(path.join(root,'fleet/agent-hierarchy/state.json')).mode&0o777,0o600);
  const clearedFixture:HierarchySnapshot={...accepted,issues:Array.from({length:251},(_,index)=>({...structuredClone(accepted.issues[0]),id:`cleared:${index}`,status:'source_cleared' as const,lastSeenAt:new Date(now-index).toISOString(),history:[...accepted.issues[0].history,{at:new Date(now-index).toISOString(),from:'expenses',to:'expenses',event:'source_cleared' as const}]}))};
  clearedFixture.issues.push({...structuredClone(accepted.issues[0]),id:'still-open'});
  const compacted=saveHierarchy(clearedFixture);
  assert.equal(compacted.issues.filter(issue=>issue.status==='source_cleared').length,200);
  assert.equal(compacted.issues.filter(issue=>issue.status==='open').length,1,'Active findings are never pruned');
  const archive=path.join(root,'fleet/agent-hierarchy/archive','2026-09');
  assert.equal(fs.readdirSync(archive).length,51);
  saveHierarchy(clearedFixture);
  assert.equal(fs.readdirSync(archive).length,51,'Archive retries are immutable and idempotent');
  assert(readHierarchy(now+5*60_000)!.agents.every(a=>a.status==='unavailable'));
  fs.writeFileSync(path.join(root,'fleet/agent-hierarchy/state.json'),'{');assert.throws(()=>readHierarchy(now),/preserved/);
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('Hierarchy passed: 32 tabs and crew flows, valid reporting tree, accepted handoffs, single owner, source failure retention, overdue escalation, reopening, monotonic state, private persistence and manager boundary.');
async function checkRunnerHistory() {
  const {runnerFindings}=await import('../lib/agent-hierarchy-inputs');
  const stages={shared:{status:'ok'},trucks:{status:'ok'},hierarchy:{status:'running'}};
  const failures=[{stage:'trucks',status:'timed_out',finishedAt:at,durationMs:20_000}];
  const recovered=runnerFindings({stages,failures},now+1000);
  assert.equal(recovered.length,1);assert.equal(recovered[0].target,'release');assert.equal(recovered[0].priority,'watch');
  assert.equal(runnerFindings({stages,failures},now+3601_000).length,0,'Successful cycles do not immediately hide a recent failure');
  assert.equal(runnerFindings({stages:{...stages,trucks:{status:'timed_out'}},failures},now+1000).length,1,'Current and historical failure share one issue');
  console.log('Runner supervision passed: recent failure retained, routed to release, deduplicated and aged out after recovery.');
}
checkRunnerHistory().catch(error=>{console.error(error);process.exitCode=1;});
