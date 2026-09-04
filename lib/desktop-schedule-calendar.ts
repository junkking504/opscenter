import fs from 'node:fs/promises';
import path from 'node:path';
import { readJobRows, junkwareScheduleUpdatedAt } from './desktop-schedule-source';
import { readJobRouteAssignmentOverrides } from './job-route-assignments';
import { readVerifiedJobCancellations } from './job-cancellations';
import { appointmentRegion, type ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';

export function desktopCalendarDay(date: string, observedAt: string | null, jobs: Array<Pick<ScheduleAppointment, 'address' | 'territory' | 'truck'>>) {
  // Daily financial metrics do not prove that the day's schedule was collected.
  // A verified timestamp establishes an observed empty day; actual source rows
  // establish non-empty availability even for an older CSV without a timestamp.
  const available = Boolean(observedAt || jobs.length);
  const territories: Record<string, number> = {};
  for (const job of jobs) { const region = appointmentRegion(job); territories[region.code] = (territories[region.code] || 0) + 1; }
  return { date, available, observedAt, count: available ? jobs.length : null, routes: available ? new Set(jobs.map(job => job.truck).filter(truck => truck && !/unassigned|—/i.test(truck))).size : null, territories };
}
export function readDesktopCalendar(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('A valid calendar month is required.');
  const count = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  return { month, days: Array.from({ length: count }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
    return desktopCalendarDay(date, junkwareScheduleUpdatedAt(date), readJobRows(date));
  }) };
}
export async function readDesktopScheduleHistory(date: string) {
  const rows: Array<{ id: string; at: string; appointmentId: string; action: string; actor: string; status: string; detail: string }> = [];
  const directory = process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR || path.join(process.cwd(), 'data', 'desktop-operations');
  let files: string[] = [];
  try { files = await fs.readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const file of files.filter(file => /^[a-f0-9-]{36}\.json$/i.test(file))) {
    const entry = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
    if (entry.date === date) rows.push({ id: entry.requestId, at: entry.updatedAt, appointmentId: String(entry.recordId).split(':appointment:')[1], action: entry.action, actor: entry.actor, status: entry.status, detail: entry.message });
  }
  for (const [key, entry] of readJobRouteAssignmentOverrides(date)) rows.push({ id: `assignment:${key}`, at: entry.updatedAt, appointmentId: entry.appointmentId || key.replace(/^appt:/, ''), action: 'assignment', actor: 'OpsCenter assignment service', status: entry.junkwareSyncStatus || 'unverified', detail: `${entry.truck || 'Unassigned'} · ${entry.appointmentTime || 'Time unchanged'}` });
  for (const entry of readVerifiedJobCancellations(date)) rows.push({ id: `cancellation:${entry.appointmentId}`, at: entry.canceledAt, appointmentId: entry.appointmentId, action: 'cancel', actor: 'OpsCenter cancellation service', status: 'verified', detail: entry.cancellationReason });
  return { date, coverage: 'Saved OpsCenter operations, latest assignment receipts and verified cancellations. This does not include every change made directly in JunkWare.', rows: rows.sort((a, b) => b.at.localeCompare(a.at)) };
}
