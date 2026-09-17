import {useCallback,useState,type ReactNode} from 'react';
import {Button} from './components/ui/button';
import {useWorkspaceSnapshot} from './use-workspace-snapshot';
import {fetchWorkspace} from './lib/workspace-cache';
import {useWorkspaceRefresh} from './workspace-freshness';
import type {HierarchySnapshot,HierarchyAssessment} from './lib/agent-hierarchy-contract';
import './agent-hierarchy.css';
const key='/api/desktop/agent-hierarchy';
const time=(at:string)=>new Date(at).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' CT';
export default function AgentHierarchy() {
  const [snapshot,setSnapshot]=useWorkspaceSnapshot<HierarchySnapshot>(key);
  const [owner,setOwner]=useState(''),[showCleared,setShowCleared]=useState(false);
  const load=useCallback(async(signal:AbortSignal)=>{const value=await fetchWorkspace<HierarchySnapshot>(key,signal);if(value.version!==1||!Array.isArray(value.agents))throw new Error('Incomplete hierarchy response.');if(!signal.aborted)setSnapshot(value);},[setSnapshot]);
  const freshness=useWorkspaceRefresh(load,key,false,30_000,key);
  if(!snapshot)return <section className="agent-hierarchy" aria-label="Agent hierarchy"><h2>Agent hierarchy</h2><p role="status">{freshness.error||'Reading agent ownership…'}</p></section>;
  const stale=freshness.now-Date.parse(snapshot.checkedAt)>180_000||Date.parse(snapshot.checkedAt)>freshness.now+60_000;
  const name=(id:string)=>snapshot.agents.find(a=>a.id===id)?.name||id;
  const children=(id:string):string[]=>[id,...snapshot.agents.filter(a=>a.parent===id).flatMap(a=>children(a.id))];
  const visible=owner?children(owner):snapshot.agents.map(a=>a.id);
  const issues=snapshot.issues.filter(i=>visible.includes(i.owner)&&(showCleared||i.status!=='source_cleared')).sort((a,b)=>Number(!!b.escalatedTo)-Number(!!a.escalatedTo)||a.dueAt.localeCompare(b.dueAt));
  const branch=(agent:HierarchyAssessment):ReactNode=> <li key={agent.id}><details open={['command','operations','engineering'].includes(agent.id)}><summary><strong>{agent.name}</strong><span>{stale?'Assessment stale':agent.status==='unavailable'?'Evidence incomplete':agent.status==='needs_review'?'Needs review':'Monitoring'} · {agent.openCount} findings{agent.overdueCount?` · ${agent.overdueCount} overdue`:''}</span></summary><p>{agent.responsibility}</p><p>{agent.detail}</p><Button variant="outline" size="sm" onClick={()=>setOwner(agent.id)}>Show {agent.name} findings</Button>{snapshot.agents.some(a=>a.parent===agent.id)&&<ul>{snapshot.agents.filter(a=>a.parent===agent.id).map(branch)}</ul>}</details></li>;
  return <section className="agent-hierarchy" aria-label="Agent hierarchy"><header><div><h2>Agent hierarchy</h2><p>{snapshot.agents.length} assigned roles · {snapshot.tabs.length} tabs covered · checked {time(snapshot.checkedAt)}</p></div><Button variant="outline" size="sm" disabled={freshness.pending} onClick={()=>void freshness.refresh().catch(()=>{})}>Refresh hierarchy</Button></header>
    <p>Operations and engineering report to Command. Agents assess existing evidence and route findings; engineering implementation and source changes use their authorized workflows.</p>
    {(stale||freshness.error)&&<p role="alert">Background evidence is stale or unavailable. Retained ownership remains in effect. {freshness.error}</p>}
    {snapshot.warnings.map(w=><p role="status" key={w}>{w}</p>)}
    <ul className="agent-hierarchy-tree">{snapshot.agents.filter(a=>a.parent===null).map(branch)}</ul>
    <details><summary>Page and tab ownership · {snapshot.tabs.length} tabs</summary><div className="agent-hierarchy-table"><table><thead><tr><th>Page</th><th>Tab</th><th>Accountable agent</th><th>Reports to</th></tr></thead><tbody>{snapshot.tabs.map(t=><tr key={`${t.page}:${t.tab}`}><td>{t.page}</td><td>{t.tab}</td><td>{name(t.owner)}</td><td>{name(snapshot.agents.find(a=>a.id===t.owner)?.parent||'command')}</td></tr>)}</tbody></table></div></details>
    <div className="agent-hierarchy-filter"><label>Findings for <select value={owner} onChange={e=>setOwner(e.target.value)}><option value="">All agents</option>{snapshot.agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label><input type="checkbox" checked={showCleared} onChange={e=>setShowCleared(e.target.checked)}/> Include source-cleared findings</label></div>
    <p>{issues.length} findings. Agent accountability supplements the human owner on the supporting record. A source-cleared finding is not proof that a repair or business action was completed.</p>
    <div className="agent-hierarchy-findings">{issues.map(issue=><details key={issue.id}><summary><strong>{issue.title}</strong><span>{issue.status==='unconfirmed'?'Evidence unconfirmed':issue.status==='source_cleared'?'Source cleared':issue.priority==='urgent'?'Urgent':'Open'} · {name(issue.owner)}</span></summary><p>{issue.detail}</p><p>Accountable: {name(issue.owner)}{issue.proposedOwner?` · Awaiting acceptance by ${name(issue.proposedOwner)}`:''}</p><p>Review due {time(issue.dueAt)}{issue.escalatedTo?` · Escalated to ${name(issue.escalatedTo)}`:''} · Last evidence {time(issue.lastSeenAt)}</p><a href={issue.href}>Open supporting record</a><ol>{issue.history.slice(-10).map((event,i)=><li key={i}>{time(event.at)} · {event.event.replaceAll('_',' ')} · {name(event.from)}{event.to!==event.from?` → ${name(event.to)}`:''}</li>)}</ol></details>)}</div>
    <details><summary>Source coverage</summary>{snapshot.feeds.map(feed=><p key={feed.id}><strong>{feed.id}</strong>: {feed.available&&!stale?'Read':'Unavailable / retained'} · {feed.detail}{feed.observedAt?` · ${time(feed.observedAt)}`:''}</p>)}</details>
  </section>;
}
