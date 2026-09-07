import { getKernelPool } from '@/lib/platform/persistence/pool';
import { reconcileOperatingInbox } from '@/lib/platform/inbox';
import { INBOX_RULES } from '@/lib/platform/work-policy';
import { readMetrics } from '@/lib/opsData';
import { controlReconciliationReady } from '@/lib/desktop-control';

export type ReconciliationSummary = {
  checked: string[];
  skipped: Array<{ date: string; reason: string }>;
  remaining: number;
};

// A bad current-day snapshot must not prevent checking valid carryover dates.
// Dates come from the shared queue, not from browser-supplied work-item IDs.
export async function reconcileControlQueue(date: string, actorId: string): Promise<ReconciliationSummary> {
  const dates = await getKernelPool().query<{ date: string }>(
    `SELECT DISTINCT operating_date::text AS date FROM opscenter_kernel.work_items
     WHERE operating_date < $1 AND status NOT IN ('resolved','dismissed') AND rule = ANY($2::text[])
     ORDER BY date`, [date, [...INBOX_RULES]]);
  return reconcileControlDates(date, dates.rows.map(row => row.date), {
    ready: day => controlReconciliationReady(day, readMetrics(day)),
    reconcile: async day => { await reconcileOperatingInbox(day, actorId); },
  });
}

// Bounded, independently checked dates make a partial result explicit and make
// retries safe: the detector never counts an unchanged snapshot as new evidence.
export async function reconcileControlDates(date: string, carryovers: string[], dependencies: {
  ready: (date: string) => boolean;
  reconcile: (date: string) => Promise<void>;
}): Promise<ReconciliationSummary> {
  const dates = [...new Set([date, ...carryovers.filter(day => day < date).sort()])];
  const result: ReconciliationSummary = { checked: [], skipped: [], remaining: Math.max(0, dates.length - 32) };
  for (const day of dates.slice(0, 32)) {
    try {
      if (!dependencies.ready(day)) {
        result.skipped.push({ date: day, reason: 'Complete, fresh metrics evidence is unavailable.' });
        continue;
      }
      await dependencies.reconcile(day);
      result.checked.push(day);
    } catch {
      result.skipped.push({ date: day, reason: 'Source check could not complete. Refresh before retrying.' });
    }
  }
  return result;
}
