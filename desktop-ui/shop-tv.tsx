import { useCallback, useState } from 'react';
import { CommandRevenueHero } from './command-revenue-hero';
import { MetricValue } from './metric-value';
import { employeeRph } from './lib/crew-rph';
import { useWorkspaceSnapshot } from './use-workspace-snapshot';
import { fetchWorkspace } from './lib/workspace-cache';
import { useWorkspaceRefresh, WorkspaceFreshness } from './workspace-freshness';
import type { DesktopCommandSnapshot } from './lib/live-contract';
import type { DesktopKreweSnapshot } from './lib/people-fleet-contract';
import { isOperatingDay } from './lib/operating-day';

export function tvLeaderboard(snapshot: DesktopKreweSnapshot | null) {
  if (!snapshot || snapshot.missingDates.length) return [];
  return [...snapshot.members].filter(member=>member.revenue != null && Number.isFinite(member.revenue))
    .sort((a,b)=>b.revenue!-a.revenue! || a.name.localeCompare(b.name)).slice(0,5);
}
const money = (value: number | null) => value == null ? null : value.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
export function ShopTv({ snapshot, error }: { snapshot: DesktopCommandSnapshot; error?: string }) {
  const key = `/api/desktop/krewe?date=${encodeURIComponent(snapshot.date)}&view=today`;
  const [crew,setCrew] = useWorkspaceSnapshot<DesktopKreweSnapshot>(key);
  const load = useCallback(async(signal:AbortSignal)=>{const body=await fetchWorkspace<DesktopKreweSnapshot>(key,signal);if(!signal.aborted)setCrew(body);},[key,setCrew]);
  const freshness = useWorkspaceRefresh(load,key,false,30_000,key);
  const [screenError,setScreenError] = useState('');
  const ranked = tvLeaderboard(crew?.date === snapshot.date ? crew : null);
  const top = ranked[0]?.revenue ?? null;
  const done = snapshot.crewProgress?.jobs.filter(job=>/^(completed|job completed|closed|paid)$/i.test(job.status)) || [];
  const exit = new URL(window.location.href);exit.searchParams.delete('tv');exit.searchParams.delete('date');exit.searchParams.set('workspace','Command');exit.searchParams.set('commandView','now');
  const synthetic = /synthetic/i.test(snapshot.actor.displayName);
  return <main className="ops-app shop-tv" aria-label="Shop TV, read only">
    <header className="tv-header"><div><strong>OpsCenter</strong><span>SHOP TV · {isOperatingDay(snapshot.date) ? snapshot.date : 'Date unavailable'}{synthetic?' · SYNTHETIC':''}</span></div><div className="tv-controls"><button type="button" onClick={()=>{void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(()=>setScreenError('Use your browser’s full-screen control.'));}}>Full screen</button><a href={exit.pathname+exit.search}>Exit TV</a></div></header>
    <div className="tv-source" role="status">Read only · Refreshes every 30 seconds · Command checked {new Date(snapshot.generatedAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})}{error ? ` · ${error}` : ''}{screenError ? ` · ${screenError}` : ''}</div>
    <CommandRevenueHero kpi={snapshot.kpis.find(kpi=>kpi.label==='Revenue')} date={snapshot.date}/>
    <section className="tv-leaderboard" aria-label="Top five crew by credited revenue"><header><h1>Top crew today</h1><span>Credited revenue · RPH from recorded worked hours</span></header><div className="tv-ranking tv-ranking-head"><span>Rank</span><span>Crew member</span><span>Revenue</span><span>RPH</span><span>Gap to #1</span></div>{ranked.map((member,index)=><div className="tv-ranking" key={member.id}><span>{index+1}</span><strong>{member.name}</strong><strong>{money(member.revenue)}</strong><span><MetricValue value={money(employeeRph(member))} reason="Valid worked hours and credited revenue are required"/></span><span>{top==null || member.revenue==null?'—':money(top-member.revenue)}</span></div>)}{!ranked.length&&<p className="tv-empty">Crew revenue is unavailable for this day.</p>}<WorkspaceFreshness state={freshness} sourceAt={crew?.sourceUpdatedAt} sourceLabel="Crew source" statusLabel={crew?.missingDates.length ? 'Incomplete source coverage' : !crew?.sourceUpdatedAt || freshness.now-Date.parse(crew.sourceUpdatedAt)>600000 ? 'Crew source is stale or unavailable · recorded revenue, not cash collected' : 'Recorded revenue; not cash collected'} /></section>
    <section className="tv-completed" aria-label="Jobs completed today"><h2>Completed today</h2><div className="tv-ticker">{done.length ? <div>{[0,1].map(copy=><span className="tv-ticker-run" key={copy} aria-hidden={copy===1}>{done.map(job=><span key={job.id}><strong>{job.truck}</strong> · {job.jobNumber} · Completed</span>)}</span>)}</div> : <p>{snapshot.crewProgress?.updatesComplete ? 'No completed jobs in this snapshot.' : 'Completed-job source coverage is incomplete.'}</p>}</div><small>JunkWare completion records · {snapshot.crewProgress?.updatesComplete ? 'Available source updates' : 'Partial update history'}</small></section>
  </main>;
}
