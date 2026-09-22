import path from 'node:path';
import type { CrewPhone } from './crew-phone';
import type { CrewCurrent, CrewScheduledJob } from './crew-dispatch';
import { readCrewDispatch } from './crew-dispatch-store';
import { readJobRows, mergeFastScheduleRows } from './desktop-schedule-source';
import { readVerifiedJunkwareScheduleSnapshot } from './junkware-fast-schedule';
import { readJobRouteAssignmentOverrides } from './job-route-assignments';
import { sameTruck } from './junkware-trucks';

const sources = {
  snapshot: (date: string) => readVerifiedJunkwareScheduleSnapshot(process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw', 'workspace', 'opsbot', 'data'), date),
  rows: readJobRows,
  overrides: readJobRouteAssignmentOverrides,
  dispatch: readCrewDispatch,
};

/** Read-only daily browsing uses the detector's complete, recent JunkWare feed.
 * It never starts a provider browser or takes a photo/closeout write lock. */
export function crewAssignedDay(phone: CrewPhone, date: string, deps = sources, now = Date.now()): CrewCurrent {
  const snapshot = deps.snapshot(date);
  const age = snapshot ? now - snapshot.freshnessAtMs : Infinity;
  if (!snapshot || snapshot.date !== date || age < 0 || age > 120_000) return {
    state: 'unavailable', truck: phone.truck, job: null, jobs: [], observedAt: null,
    message: 'Today’s assignments are updating. Try Refresh assignments in a moment.',
  };
  // The verified feed owns membership, truck and status; richer local rows only
  // supply notes/items. An omitted or moved appointment cannot survive a merge.
  const rows = mergeFastScheduleRows(deps.rows(date), snapshot.appointments, snapshot.cancelled, date);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.appointmentId, (counts.get(row.appointmentId) || 0) + 1);
  const overrides = deps.overrides(date);
  const current = deps.dispatch(phone.truck).current;
  const jobs: CrewScheduledJob[] = rows.filter(row => {
    const override = overrides.get(`appt:${row.appointmentId}`);
    return /^\d{1,12}$/.test(row.appointmentId) && counts.get(row.appointmentId) === 1
      && sameTruck(row.assignedTruck || row.truck, phone.truck) && /^(confirmed|completed)$/i.test(row.status)
      && (!override || (override.junkwareSyncStatus === 'verified' && sameTruck(override.truck, phone.truck)));
  }).sort((a, b) => (a.appointmentStartMinutes ?? 1440) - (b.appointmentStartMinutes ?? 1440) || a.appointmentId.localeCompare(b.appointmentId))
    .map(row => ({
      appointmentId: row.appointmentId, date, jkNumber: row.jkNumber, customerName: row.customerName,
      address: row.address, appointmentTime: row.appointmentTime, junkItems: row.junkItems,
      appointmentNotes: row.appointmentNotes, driver: row.driver, navigator: row.navigator, status: row.status,
      ...(current?.date === date && current.appointmentId === row.appointmentId ? { assignmentId: current.assignmentId } : {}),
    }));
  const active = jobs.find(job => job.assignmentId);
  return {state: jobs.length ? 'assigned' : 'waiting', truck: phone.truck, observedAt: new Date(snapshot.freshnessAtMs).toISOString(), jobs,
    job: active?.assignmentId ? {...active, assignmentId: active.assignmentId} : null};
}
