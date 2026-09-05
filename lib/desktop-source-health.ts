import { getDataHealthReport } from '@/lib/data-health';
import { getOperationalReadiness } from '@/lib/operational-readiness';
import { readSearchKingsSnapshot } from '@/lib/searchkings';
import { readPodiumGoogleReviewsSnapshot } from '@/lib/podium-reviews';
import { sourceFreshness } from '@/lib/source-freshness';
import type { DesktopSourceHealth } from '../desktop-ui/lib/live-contract';

export function readDesktopSourceHealth(canFinance: boolean): DesktopSourceHealth[] {
  const health = getDataHealthReport();
  const readiness = getOperationalReadiness();
  const rows: DesktopSourceHealth[] = Object.values(health.sources).filter(row => canFinance || row.key !== 'qbo').map(row => ({
    name: row.key==='linxup'?'LinxUp':row.key==='qbo'?'QuickBooks':'JunkWare', area:row.details,
    workspace:row.key==='linxup'?'Fleet':row.key==='qbo'?'Finance':'Schedule', action:'Review source',
    state:row.stateLabel,tone:row.status==='green'?'healthy':'warning',observedAt:row.lastSuccessfulAt,maxAgeSeconds:row.key==='linxup'?180:600,
  }));
  const timed = (name: string, observedAt: string | null, maxAgeSeconds: number, area: string, workspace: string): DesktopSourceHealth => ({name,observedAt,maxAgeSeconds,area,workspace,action:'Review source',state:sourceFreshness(observedAt,maxAgeSeconds).fresh?'Current':observedAt?'Stale':'Unavailable',tone:sourceFreshness(observedAt,maxAgeSeconds).fresh?'healthy':'warning'});
  rows.push(timed('SearchKings',readSearchKingsSnapshot()?.fetchedAt||null,1200,'Lead demand · collection at least 15 minutes apart','Marketing'));
  rows.push(timed('Podium',readPodiumGoogleReviewsSnapshot()?.fetchedAt||null,1800,'Reviews · 15 minute collector','Marketing'));
  const sync=readiness.crewPortalSync;
  rows.push({...timed('Crew Portal',sync.lastSuccessAt,sync.maxAgeSeconds,'Employee portal delivery','Krewe'),state:sync.status==='failed'?'Failed':sync.ok?'Verified publication':'Stale / unavailable',tone:sync.ok?'healthy':'warning',area:`Employee portal delivery. ${sync.error||''} Last attempt: ${sync.lastAttemptAt||'unavailable'}`,href:'https://crew.junk-king.app/my-pay'});
  const q=readiness.photoQueue;
  rows.push({name:'WhatsApp photos',workspace:'Command',action:'Review photo decisions',state:!q.available?'Queue unavailable':q.ok?'Clear':'Needs review',tone:q.ok?'healthy':'warning',observedAt:new Date().toISOString(),maxAgeSeconds:120,area:`${q.counts.review} review · ${q.counts.failed} failed · ${q.counts.incoming} incoming · ${q.counts.processing} processing. ${q.olderThan24Hours} unresolved over 24h. ${Object.entries(q.reasons).map(([reason,count])=>`${count} ${reason.replaceAll('_',' ')}`).join('; ')}`,href:'/desktop?data=live&workspace=Command&commandView=today'});
  return rows.map(row=>row.tone==='healthy'&&!sourceFreshness(row.observedAt,row.maxAgeSeconds).fresh?{...row,state:'Stale / unavailable',tone:'warning'}:row);
}
