import fs from 'node:fs';
import path from 'node:path';
import {readDesktopSourceHealth} from './desktop-source-health';
import {readMaintenanceState} from './maintenance-monitor';
import {resolveKernelDatabaseConfig} from './platform/persistence/config';
import {getKernelPool} from './platform/persistence/pool';
import {truckAgentRoot} from './truck-agent-inputs';
import {hierarchyFresh,projectHierarchy,readHierarchy,saveHierarchy} from './agent-hierarchy';
import type {HierarchyFeed,HierarchyFinding} from '../desktop-ui/lib/agent-hierarchy-contract';
import type {TruckAgent} from '../desktop-ui/lib/truck-agent-contract';
import type {OperationalAgentState} from './operational-agents';
const monitor='/desktop?data=live&workspace=Command&commandView=monitor';
const read=(relative:string)=>JSON.parse(fs.readFileSync(path.join(truckAgentRoot(),relative),'utf8'));
const targetForRule:Record<string,string>={repair:'maintenance',service:'maintenance','inspection-stop':'inspection','inspection-defect':'inspection',odometer:'inspection','inspection-missing':'staffing',fuel:'staffing',crew:'staffing',capacity:'capacity',disposal:'capacity',receipt:'expenses',identity:'integrations',source:'integrations',gps:'integrations',photos:'control',closeout:'control','appointment-progress':'dispatch','assigned-restriction':'dispatch',window:'dispatch','schedule-freshness':'integrations'};
export async function readHierarchyFeeds(date:string,now=Date.now()):Promise<HierarchyFeed[]> {
  const feeds:HierarchyFeed[]=[], at=new Date(now).toISOString();
  const unavailable=(id:string,detail:string)=>feeds.push({id,available:false,observedAt:null,detail,findings:[]});
  try {for(const source of readDesktopSourceHealth(true)) {
    const available=hierarchyFresh(source.observedAt,now,source.maxAgeSeconds*1000);
    feeds.push({id:source.name,available,observedAt:source.observedAt,detail:source.state,findings:source.tone==='healthy'&&available?[]:[{id:`source:${source.name}`,feed:source.name,title:`${source.name}: ${source.state}`,detail:source.area,href:source.href||monitor,origin:'operations',target:'integrations',priority:'next'}]});
  }}catch {for(const id of ['JunkWare','LinxUp','QuickBooks','SearchKings','Podium','Crew Portal','WhatsApp photos'])unavailable(id,'Source health could not be read.');}
  try {
    const saved=read(`fleet/truck-agents/${date}.json`) as {version:number;heartbeatAt:string;agents:TruckAgent[]};
    if(saved.version!==1||saved.agents.length!==9)throw new Error('Incomplete truck assessment');
    const available=hierarchyFresh(saved.heartbeatAt,now)&&saved.agents.every(a=>a.status!=='error');
    feeds.push({id:'truck-assessments',available,observedAt:saved.heartbeatAt,detail:available?'Nine local truck assessments read.':'Truck assessments stale or failed.',findings:saved.agents.flatMap(agent=>agent.recommendations.filter(r=>r.rule!=='ready').map(r=>({id:r.id,feed:'truck-assessments',title:`${agent.truck}: ${r.title}`,detail:r.detail,href:r.href,origin:agent.id,target:targetForRule[r.rule]||'convoy',priority:r.priority})))});
  }catch {unavailable('truck-assessments','Truck assessment snapshot could not be read.');}
  try {
    const shared=read(`fleet/agents/${date}.json`) as OperationalAgentState;
    if(shared.version!==1||shared.date!==date)throw new Error('Invalid shared state');
    for(const id of ['visit-tracking','unload-cost'] as const) {
      const state=shared.agents[id],available=hierarchyFresh(state.heartbeatAt,now)&&['ok','degraded'].includes(state.status)&&!!state.result&&(id!=='unload-cost'||state.dependency==='current');
      feeds.push({id,available,observedAt:state.heartbeatAt,detail:state.status,findings:state.status==='ok'&&available?[]:[{id:`shared:${id}`,feed:id,title:`${id}: ${state.status}`,detail:state.error||'Review shared evidence and its unresolved source or reconciliation conditions.',href:monitor,origin:id,target:id==='unload-cost'&&available&&state.dependency==='current'?'expenses':'integrations',priority:'next'}]});
    }
  }catch {unavailable('visit-tracking','Shared visit evidence unavailable.');unavailable('unload-cost','Shared cost evidence unavailable.');}
  try {
    const state=readMaintenanceState(path.join(truckAgentRoot(),'integrations/opscenter-maintenance'));
    feeds.push({id:'maintenance-observer',available:hierarchyFresh(state.checkedAt,now),observedAt:state.checkedAt,detail:'Existing maintenance observations; engineering execution requires a scoped task.',findings:state.incidents.filter(i=>i.status!=='resolved').map(i=>({id:`maintenance:${i.key}`,feed:'maintenance-observer',title:i.title,detail:`${i.evidence} ${i.nextStep}`,href:monitor,origin:'engineering',target:i.key.startsWith('client-')?'verification':/source|sync|gps|queue|collector/i.test(i.key)?'integrations':'implementation',priority:i.kind==='technical'?'next':'watch'}))});
  }catch {unavailable('maintenance-observer','Maintenance observations could not be read.');}
  try {
    const state=read('fleet/agents/worker-status.json') as {startedAt:string;stages:Record<string,{status:string;finishedAt?:string;durationMs?:number}>};
    if(!state.stages)throw new Error('Runner state missing');
    feeds.push({id:'runner',available:hierarchyFresh(state.startedAt,now),observedAt:state.startedAt,detail:'Per-stage local deadlines and last execution results.',findings:Object.entries(state.stages).filter(([id,s])=>id!=='hierarchy'&&s.status!=='ok').map(([id,s])=>({id:`runner:${id}`,feed:'runner',title:`Agent runner ${id}: ${s.status}`,detail:`Last stage duration: ${s.durationMs??'unknown'} ms. Prior successful evidence is retained.`,href:monitor,origin:'engineering',target:'release',priority:'urgent'}))});
  }catch {unavailable('runner','Runner execution evidence unavailable.');}
  if(resolveKernelDatabaseConfig().status==='ready') {
    try {
      const pool=getKernelPool();
      const client=await pool.connect();
      try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '4s'");
      const result=await client.query<{id:string;category:string;title:string;description:string;severity:string}>({text:"SELECT id,category,title,description,severity FROM opscenter_kernel.work_items WHERE operating_date <= $1 AND status NOT IN ('resolved','dismissed') ORDER BY id LIMIT 5001",values:[date]});
      const owner:Record<string,string>={Jobs:'control',Crew:'crew',Fleet:'convoy',Finance:'capital',Marketing:'campaign',Systems:'integrations'};
      const findings:HierarchyFinding[]=result.rows.slice(0,5000).map(r=>({id:`work-item:${r.id}`,feed:'operating-queue',title:r.title,detail:r.description,href:`/desktop?data=live&workspace=Command&commandView=today&action=${encodeURIComponent(r.id)}`,origin:'operations',target:owner[r.category]||'operations',priority:r.severity==='critical'?'urgent':r.severity==='warning'?'next':'watch'}));
      feeds.push({id:'operating-queue',available:result.rows.length<=5000,observedAt:at,detail:result.rows.length<=5000?'Existing work item IDs; human ownership and source actions stay in Control.':'Queue exceeds safe read bound; retained ownership requires review.',findings});
      }finally {try{await client.query('ROLLBACK');}finally{client.release();}}
    }catch {unavailable('operating-queue','Existing operating queue could not be read; prior assignments remain.');}
  }else unavailable('operating-queue','Existing operating queue is not configured for this runtime.');
  // Every unavailable dependency becomes owned work, even without prior findings.
  for(const feed of feeds)if(!feed.available)feed.findings.push({id:`coverage:${feed.id}`,feed:feed.id,title:`Evidence unavailable: ${feed.id}`,detail:feed.detail,href:monitor,origin:'engineering',target:'integrations',priority:'next'});
  return feeds;
}
export async function runHierarchy(date:string,now=Date.now()) {
  const feeds=await readHierarchyFeeds(date,now), prior=readHierarchy(now);
  const result=projectHierarchy(date,feeds,now,prior);saveHierarchy(result);return result;
}
