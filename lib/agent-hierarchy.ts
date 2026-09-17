import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hierarchyAgents,hierarchyTabs,type HierarchyFeed,type HierarchyIssue,type HierarchySnapshot,type HierarchyAssessment} from '../desktop-ui/lib/agent-hierarchy-contract';
import {truckAgentRoot} from './truck-agent-inputs';
const stamp=(now:number)=>new Date(now).toISOString();
export const hierarchyFresh=(at:string|null,now:number,max=180_000)=>!!at && Number.isFinite(Date.parse(at)) && now-Date.parse(at)>=-60_000 && now-Date.parse(at)<=max;
export function projectHierarchy(date:string,feeds:HierarchyFeed[],now:number,prior:HierarchySnapshot|null=null):HierarchySnapshot {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Valid operating date required.');
  if(prior && Date.parse(prior.checkedAt)>now)return prior;
  const byId=new Map(hierarchyAgents.map(a=>[a.id,a])), feedMap=new Map(feeds.map(f=>[f.id,f]));
  const ready=(id:string)=>{const a=byId.get(id);return !!a && a.dependencies.every(key=>feedMap.get(key)?.available);};
  const issues=new Map((prior?.issues||[]).map(i=>[i.id,structuredClone(i)]));
  const seen=new Set<string>();
  for(const feed of feeds)for(const finding of feed.findings) {
    if(seen.has(finding.id))throw new Error('Duplicate hierarchy issue identity.');
    if(!byId.has(finding.origin)||!byId.has(finding.target))throw new Error('Unknown hierarchy owner.');
    seen.add(finding.id);
    const old=issues.get(finding.id), at=stamp(now);
    const issue:HierarchyIssue=old ? {...old,...finding} : {...finding,owner:finding.origin,proposedOwner:null,status:'open',firstSeenAt:at,lastSeenAt:at,dueAt:stamp(now+(finding.priority==='urgent'?15:finding.priority==='next'?60:1440)*60_000),escalatedTo:null,history:[{at,from:finding.origin,to:finding.origin,event:'assigned'}]};
    if(old?.status==='source_cleared') {issue.firstSeenAt=at;issue.dueAt=stamp(now+(finding.priority==='urgent'?15:finding.priority==='next'?60:1440)*60_000);issue.history.push({at,from:issue.owner,to:issue.owner,event:'reopened'});}
    if(old && finding.priority==='urgent' && old.priority!=='urgent')issue.dueAt=stamp(Math.min(Date.parse(issue.dueAt),now+15*60_000));
    issue.status=feed.available?'open':'unconfirmed';issue.lastSeenAt=feed.observedAt||old?.lastSeenAt||at;
    if(issue.owner!==finding.target) {
      if(issue.proposedOwner!==finding.target)issue.history.push({at,from:issue.owner,to:finding.target,event:'proposed'});
      issue.proposedOwner=finding.target;
      // The receiver accepts only after evaluating its declared dependencies
      // and this exact finding on an available feed. Ownership never disappears.
      if(feed.available && ready(finding.target)) {issue.history.push({at,from:issue.owner,to:finding.target,event:'accepted'});issue.owner=finding.target;issue.proposedOwner=null;}
    }
    issues.set(issue.id,issue);
  }
  for(const issue of issues.values()) {
    if(!seen.has(issue.id) && issue.status!=='source_cleared') {
      if(feedMap.get(issue.feed)?.available) {issue.status='source_cleared';issue.proposedOwner=null;issue.history.push({at:stamp(now),from:issue.owner,to:issue.owner,event:'source_cleared'});}
      else issue.status='unconfirmed';
    }
    issue.escalatedTo=issue.status!=='source_cleared' && (issue.status==='unconfirmed'||Date.parse(issue.dueAt)<=now) ? byId.get(issue.owner)?.parent||'command':null;
  }
  const result=[...issues.values()];
  const descendants=(id:string):string[]=>[id,...hierarchyAgents.filter(a=>a.parent===id).flatMap(a=>descendants(a.id))];
  const agents:HierarchyAssessment[]=hierarchyAgents.map(a=>{
    const members=descendants(a.id), active=result.filter(i=>members.includes(i.owner)&&i.status!=='source_cleared');
    const missing=hierarchyAgents.filter(child=>members.includes(child.id)).flatMap(child=>child.dependencies).filter(key=>!feedMap.get(key)?.available);
    return {...a,status:missing.length?'unavailable':active.length?'needs_review':'monitoring',checkedAt:stamp(now),openCount:active.length,overdueCount:active.filter(i=>Date.parse(i.dueAt)<=now).length,
      detail:missing.length?`Evidence unavailable: ${[...new Set(missing)].join(', ')}.`:active.length?`${active.length} existing findings require follow-through.`:'Declared source checks completed. This does not certify business outcomes or execute repairs.'};
  });
  return {version:1,date,checkedAt:stamp(now),agents,tabs:hierarchyTabs,feeds:feeds.map(({findings:_,...f})=>f),issues:result,warnings:[]};
}
const file=()=>path.join(truckAgentRoot(),'fleet','agent-hierarchy','state.json');
export function readHierarchy(now=Date.now()):HierarchySnapshot|null {
  let state:HierarchySnapshot;
  try{state=JSON.parse(fs.readFileSync(file(),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error('Hierarchy history is unreadable; retained records were preserved.');}
  if(state.version!==1||!Array.isArray(state.issues)||!Array.isArray(state.agents)||!Array.isArray(state.feeds))throw new Error('Hierarchy history is incomplete.');
  if(!Number.isFinite(Date.parse(state.checkedAt)) || state.issues.some(i=>!i.id||!i.feed||!hierarchyAgents.some(a=>a.id===i.owner)||!Array.isArray(i.history)||!Number.isFinite(Date.parse(i.dueAt))))throw new Error('Hierarchy ownership history is incomplete; existing state preserved.');
  try {
    const worker=JSON.parse(fs.readFileSync(path.join(truckAgentRoot(),'fleet/agents/worker-status.json'),'utf8'));
    if(['failed','timed_out'].includes(worker.stages?.hierarchy?.status))state={...state,warnings:[...state.warnings,'The last hierarchy worker failed or timed out. Prior ownership is retained.']};
  }catch {/* Missing worker evidence is independently assessed by the hierarchy. */}
  if(!hierarchyFresh(state.checkedAt,now))return {...state,agents:state.agents.map(a=>({...a,status:'unavailable',detail:'Background assessment is stale. Retained findings require a fresh check.'})),warnings:['Hierarchy background assessment is unavailable or older than three minutes.']};
  return state;
}
export function saveHierarchy(state:HierarchySnapshot) {
  if(process.env.OPSCENTER_AGENT_LOCK_HELD!=='1')throw new Error('Hierarchy requires the operational worker lock.');
  const target=file();fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  const temp=`${target}.${randomUUID()}.tmp`,fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{fs.renameSync(temp,target);const parent=fs.openSync(path.dirname(target),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
