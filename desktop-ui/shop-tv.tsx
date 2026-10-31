import { SectionLayout } from './section-layout';
import { useCallback, useEffect, useState } from 'react';
import { CommandRevenueHero, metricNumber } from './command-revenue-hero';
import { tvTruckStandings, type TvSpotlights } from './lib/tv-spotlights';
import { MetricValue } from './metric-value';
import { employeeRph } from './lib/crew-rph';
import { useWorkspaceSnapshot } from './use-workspace-snapshot';
import { fetchWorkspace } from './lib/workspace-cache';
import { useWorkspaceRefresh, WorkspaceFreshness } from './workspace-freshness';
import type { DesktopCommandSnapshot } from './lib/live-contract';
import type { DesktopKreweSnapshot } from './lib/people-fleet-contract';
import { isOperatingDay } from './lib/operating-day';
import { isCompletedTvJob } from './lib/shop-tv-completion';

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
  const spotlightKey = `/api/desktop/tv?date=${encodeURIComponent(snapshot.date)}`;
  const [spotlights, setSpotlights] = useWorkspaceSnapshot<TvSpotlights>(spotlightKey);
  const loadSpotlights = useCallback(async(signal:AbortSignal)=>{const body=await fetchWorkspace<TvSpotlights>(spotlightKey,signal);if(!signal.aborted)setSpotlights(body);},[spotlightKey,setSpotlights]);
  const spotlightFreshness = useWorkspaceRefresh(loadSpotlights,spotlightKey,false,60_000,spotlightKey);
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(()=>{const query=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReducedMotion(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
  const activeSpotlights = spotlights?.date === snapshot.date ? spotlights : null;
  const cards = activeSpotlights?.cards || [];
  const card = cards[slide % Math.max(1,cards.length)];
  useEffect(()=>{if(paused || reducedMotion)return;const timer=window.setInterval(()=>{if(document.visibilityState==='visible')setSlide(value=>value+1);},15_000);return()=>clearInterval(timer);},[paused,reducedMotion,cards.length]);
  const [screenError,setScreenError] = useState('');
  const ranked = tvLeaderboard(crew?.date === snapshot.date ? crew : null);
  const top = ranked[0]?.revenue ?? null;
  const done = snapshot.crewProgress?.jobs.filter(job=>isCompletedTvJob(job.status)) || [];
  const doneOffset = (slide % Math.max(1, Math.ceil(done.length / 3))) * 3;
  const shownDone = reducedMotion ? done.slice(doneOffset, doneOffset + 3) : done;
  const trucks = tvTruckStandings(snapshot);
  const truckOffset = (slide % Math.max(1, Math.ceil(trucks.length / 4))) * 4;
  const shownTrucks = trucks.slice(truckOffset, truckOffset + 4);
  const revenueKpi = snapshot.kpis.find(kpi=>kpi.label==='Revenue');
  const revenue = metricNumber(revenueKpi?.value);
  const goalReached = revenue != null && revenueKpi?.goal != null && revenueKpi.goal > 0 && revenue >= revenueKpi.goal;
  const exit = new URL(window.location.href);exit.searchParams.delete('tv');exit.searchParams.delete('date');exit.searchParams.set('workspace','Command');exit.searchParams.set('commandView','now');
  const synthetic = /synthetic/i.test(snapshot.actor.displayName);
  return <main className="ops-app shop-tv" aria-label="The Huddle, read only">
    <header className="tv-header"><div><strong>OpsCenter</strong><span>THE HUDDLE · {isOperatingDay(snapshot.date) ? snapshot.date : 'Date unavailable'}{synthetic?' · SYNTHETIC':''}</span></div><div className="tv-controls"><button type="button" onClick={()=>{void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(()=>setScreenError('Use your browser’s full-screen control.'));}}>Full screen</button><a href={exit.pathname+exit.search}>Exit TV</a></div></header>
    <div className="tv-source" role="status">Read only · Refreshes every 30 seconds · Dashboard checked {new Date(snapshot.generatedAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})}{error ? ` · ${error}` : ''}{screenError ? ` · ${screenError}` : ''}</div>
    <CommandRevenueHero kpi={revenueKpi} date={snapshot.date}/>
    <div className={`tv-win-strip${goalReached?' tv-goal-reached':''}`}><strong>{goalReached ? 'DAILY GOAL HIT — GREAT WORK, TEAM!' : 'LET’S MAKE TODAY A WIN'}</strong><span>{snapshot.crewProgress?.scheduleCurrent ? `${done.length} completed ${done.length===1?'job':'jobs'}` : 'Completed jobs unavailable'} · Every great customer experience counts</span></div>
    <SectionLayout as="div" group="shop-tv-tv-main-grid" className="tv-main-grid"><SectionLayout as="div" group="shop-tv-tv-scoreboards" data-layout-id="tv-main-grid-panel-1" className="tv-scoreboards">
    <section data-layout-id="tv-scoreboards-panel-1" className="tv-leaderboard" aria-label="Top five crew by credited revenue"><header><h1>Top Crew Today</h1><span>Credited revenue · RPH from recorded worked hours</span></header><div className="tv-ranking tv-ranking-head"><span>Rank</span><span>Crew member</span><span>Revenue</span><span>RPH</span><span>Gap to #1</span></div>{ranked.map((member,index)=><div className="tv-ranking" key={member.id}><span>{index+1}</span><strong>{member.name}</strong><strong>{money(member.revenue)}</strong><span><MetricValue value={money(employeeRph(member))} reason="Valid worked hours and credited revenue are required"/></span><span>{top==null || member.revenue==null?'—':money(top-member.revenue)}</span></div>)}{!ranked.length&&<p className="tv-empty">Crew revenue is unavailable for this day.</p>}<WorkspaceFreshness state={freshness} sourceAt={crew?.sourceUpdatedAt} sourceLabel="Crew source" statusLabel={crew?.missingDates.length ? 'Incomplete source coverage' : !crew?.sourceUpdatedAt || freshness.now-Date.parse(crew.sourceUpdatedAt)>600000 ? 'Crew source is stale or unavailable · recorded revenue, not cash collected' : 'Recorded revenue; not cash collected'} /></section>
    <section data-layout-id="tv-scoreboards-panel-2" className="tv-trucks" aria-label="Truck showdown"><header><h2>Truck Showdown</h2><small>Most completed jobs leads</small></header><div className="tv-truck-row tv-truck-head"><span>Truck / crew</span><span>Jobs</span><span>Revenue</span><span>Avg ticket</span></div>{shownTrucks.map(truck=><div className="tv-truck-row" key={truck.truck}><div><strong>{truck.truck}</strong><small>{truck.crew || 'Crew unavailable'}</small></div><strong>{truck.jobs}</strong><span>{money(truck.revenue) ?? '—'}</span><span>{money(truck.average) ?? '—'}</span></div>)}{!trucks.length&&<p>No source-confirmed truck completions available yet.</p>}<small>Completed-job totals · missing prices stay unavailable{trucks.length>4?` · trucks ${truckOffset+1}–${Math.min(truckOffset+4,trucks.length)} of ${trucks.length}`:''}</small></section>
    </SectionLayout><section data-layout-id="tv-main-grid-panel-2" className="tv-spotlight" aria-label="Crew spotlight"><header><span>CREW SPOTLIGHT</span><div><button type="button" onClick={()=>setPaused(value=>!value)}>{paused?'Play':'Pause'}</button><button type="button" onClick={()=>setSlide(value=>value+1)} disabled={cards.length<2 && trucks.length<=4 && (!reducedMotion || done.length<=3)}>Next</button></div></header>{card?<article key={card.id} className={`tv-spotlight-card tv-card-${card.kind}`}><span className="tv-card-kind">{card.kind==='review'?'★★★★★ · CUSTOMER SHOUT-OUT':card.kind.replace('_',' ').toUpperCase()}</span><h2>{card.title}</h2><p>{card.body}</p>{card.kind==='review'&&<div className="tv-review-author">— {card.author || 'Reviewer name unavailable'}</div>}{card.before&&card.after&&<div className="tv-photo-pair">{[[card.before,'Before'],[card.after,'After']].map(([url,label])=><figure key={label}><img src={url} alt={`${label} the crew’s cleanup`} onError={event=>{event.currentTarget.hidden=true;}}/><figcaption>{label}</figcaption></figure>)}</div>}<strong>{card.credit}</strong><small>{card.detail}</small>{card.attributionContext && <details><summary>Attribution context</summary><small>{card.attributionContext}</small></details>}</article>:<article><h2>Your Next Win Goes Here</h2><p>Five-star reviews, personal records, crew celebrations and cleanup wins.</p><small>{activeSpotlights?'No eligible spotlights available yet.':'Spotlight source unavailable.'}</small></article>}<footer><span>{cards.length?`${slide%cards.length+1} / ${cards.length}`:'Waiting for the next shout-out'} · {reducedMotion?'Manual rotation':paused?'Paused':'Rotates every 15 seconds'}</span><WorkspaceFreshness state={spotlightFreshness} sourceAt={activeSpotlights?.generatedAt} sourceLabel="Spotlights" statusLabel={activeSpotlights?.reviewsAt && spotlightFreshness.now-Date.parse(activeSpotlights.reviewsAt)>86400000 ? 'Review feed is over 24 hours old' : undefined}/><small>Reviews checked: {activeSpotlights?.reviewsAt ? new Date(activeSpotlights.reviewsAt).toLocaleString('en-US',{timeZone:'America/Chicago'}) : 'unavailable'} · History: {activeSpotlights?.historyAt ? new Date(activeSpotlights.historyAt).toLocaleString('en-US',{timeZone:'America/Chicago'}) : 'unavailable'}</small>{activeSpotlights?.notices.map(notice=><small key={notice}>{notice}</small>)}</footer></section></SectionLayout>
    <section className="tv-completed" aria-label="Jobs completed today"><h2>Completed Today</h2><div className="tv-ticker">{done.length && snapshot.crewProgress?.scheduleCurrent ? <div>{[0,1].map(copy=><span className="tv-ticker-run" key={copy} aria-hidden={copy===1}>{shownDone.map(job=><span key={job.id}><strong>{job.truck}</strong> · {job.jobNumber} · Completed</span>)}</span>)}</div> : <p>{snapshot.crewProgress?.scheduleCurrent ? 'No completed jobs in this snapshot.' : 'Completed-job source coverage is incomplete.'}</p>}</div><small>JunkWare completion records · {snapshot.crewProgress?.updatesComplete ? 'Available source updates' : 'Partial update history'}</small></section>
  </main>;
}
