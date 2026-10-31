import type { DesktopCommandSnapshot } from './live-contract';
import { cachedWorkspace } from './workspace-cache';

export const commandSnapshotUrl = (date: string, summary = false) =>
  `/api/desktop/command?date=${encodeURIComponent(date)}${summary ? '&part=summary' : ''}`;

export function cachedCommandSnapshot(date: string): DesktopCommandSnapshot | undefined {
  const complete = cachedWorkspace<DesktopCommandSnapshot>(commandSnapshotUrl(date));
  const summary = cachedWorkspace<DesktopCommandSnapshot>(commandSnapshotUrl(date, true));
  const saved = complete?.value || summary?.value;
  if (saved?.date !== date) return;
  return summary && complete && summary.receivedAt > complete.receivedAt
    ? mergeCommandSummary(complete.value, summary.value) : saved;
}

/** Refresh financial evidence without clearing a previously verified same-day feed. */
export function mergeCommandSummary(previous: DesktopCommandSnapshot | null, summary: DesktopCommandSnapshot): DesktopCommandSnapshot {
  if (!previous || previous.date !== summary.date || previous.loading || previous.updatesLoading) return summary;
  // Keep the feed's original verification timestamp until its own read completes.
  return {...previous, kpis: summary.kpis, sources: {...previous.sources, metrics: summary.sources.metrics}};
}
