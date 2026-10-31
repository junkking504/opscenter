import { useCallback, useState } from 'react';
import { useWorkspaceSnapshot } from './use-workspace-snapshot';
import { fetchWorkspace } from './lib/workspace-cache';
import { useWorkspaceRefresh, WorkspaceFreshness } from './workspace-freshness';
import { useRegisterDisplayedRefresh } from './displayed-refresh';
import type { DesktopKreweSnapshot } from './lib/people-fleet-contract';
import { leaderboardRange, rankKrewe, type LeaderboardMeasure, type LeaderboardPeriod } from './lib/krewe-presentation';
import './krewe-presentation.css';

export default function KreweLeaderboard({ date }: { date: string }) {
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const [measure, setMeasure] = useState<LeaderboardMeasure>('rph');
  const view = period === 'today' ? 'today' : period === 'week' ? 'payperiod' : 'monthly';
  const key = `/api/desktop/krewe?date=${encodeURIComponent(date)}&view=${view}`;
  const [snapshot, setSnapshot] = useWorkspaceSnapshot<DesktopKreweSnapshot>(key);
  const load = useCallback(async (signal: AbortSignal) => {
    const body = await fetchWorkspace<DesktopKreweSnapshot>(key, signal);
    if (!signal.aborted) setSnapshot(body);
  }, [key, setSnapshot]);
  const freshness = useWorkspaceRefresh(load, key, false, 30_000, key);
  useRegisterDisplayedRefresh('Krewe', freshness.refreshDisplayed, false, key);
  const range = leaderboardRange(date, period);
  const ranked = rankKrewe(snapshot, date, period, measure);
  return <section className="krewe-leaderboard" aria-label="Krewe Leaderboard">
    <WorkspaceFreshness state={freshness} sourceAt={snapshot?.sourceUpdatedAt}/>
    <h2>Leaderboard</h2><p>{range.start} – {range.end} · At least 8 recorded hours to rank. Two-person Krewes keep their existing shared credit.</p>
    <div className="krewe-leaderboard-controls"><label>Period<select aria-label="Leaderboard Period" value={period} onChange={event => setPeriod(event.target.value as LeaderboardPeriod)}><option value="today">Today</option><option value="week">Week</option><option value="month">Month</option></select></label><label>Measure<select aria-label="Leaderboard Measure" value={measure} onChange={event => setMeasure(event.target.value as LeaderboardMeasure)}><option value="rph">Revenue per Hour</option><option value="jobs">Jobs Completed</option><option value="driving">Driving Score</option></select></label></div>
    <p>Driving Score averages confirmed truck scores for the selected period. Missing or unconfirmed scores are excluded from ranking.</p>
    {!snapshot ? <p role="status">Loading Krewe records…</p> : !ranked.length ? <p role="status">No eligible rankings for this selection. Complete source records and at least 8 hours are required.</p> : <ol aria-label="Rankings">{ranked.map(row => <li key={row.id}><b>{row.rank}</b><span><strong>{row.name}</strong><small>{row.hours.toLocaleString('en-US', { maximumFractionDigits: 2 })} recorded hrs</small></span><strong>{measure === 'rph' ? row.value.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : row.value.toLocaleString('en-US', { maximumFractionDigits: 1 })}</strong></li>)}</ol>}
  </section>;
}
