import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CrewPhone } from './crew-phone';
import type { CrewCurrent, CrewScheduledJob } from './crew-dispatch';
import { readCrewDispatch } from './crew-dispatch-store';
import { readJobRows, mergeFastScheduleRows } from './desktop-schedule-source';
import { readVerifiedJunkwareScheduleSnapshot } from './junkware-fast-schedule';
import { readJobRouteAssignmentOverrides } from './job-route-assignments';
import { sameTruck, truckNumber } from './junkware-trucks';
import { applyStopOrders } from './desktop-stop-order-store';
import { compareStops } from './schedule-stop-order';

const sources = {
  snapshot: (date: string) => readVerifiedJunkwareScheduleSnapshot(process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw', 'workspace', 'opsbot', 'data'), date),
  rows: readJobRows,
  overrides: readJobRouteAssignmentOverrides,
  dispatch: readCrewDispatch,
};
const safePaymentDetail=(method:string,detail:string)=>{
  const value=String(detail || '').trim();
  if(!/card/i.test(method))return value;
  const digits=value.replace(/\D/g,'');
  return digits.length>=4?digits.slice(-4):'';
};
/** The schedule appends its duration to status text after completion. */
export function crewAppointmentStatus(value:string) {
  const match=/^(confirmed|completed)(?:\s+duration:\s*\d+\s*min\(s\))?$/i.exec(value.trim());
  return match?match[1].toLowerCase()==='completed'?'Completed':'Confirmed':null;
}

export function crewAssignmentUpdateToken(payload: CrewCurrent) {
  return createHash('sha256').update(JSON.stringify({
    state:payload.state,
    truck:payload.truck,
    job:payload.job?.assignmentId || null,
    jobs:payload.jobs || [],
  })).digest('hex');
}

/** Stable UUID-shaped scope for a truck-day appointment. This value is not
 * authority by itself; every operation rechecks the phone, truck, day and source. */
export function crewScheduleAssignmentId(truck:string,date:string,appointmentId:string) {
  const number=truckNumber(truck);
  if(number===null || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,12}$/.test(appointmentId))throw new Error('A valid truck-day appointment is required.');
  const hex=createHash('sha256').update(`waypoint-truck-day-v1\0${number}\0${date}\0${appointmentId}`).digest('hex').slice(0,32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

function withUpdateToken(payload:CrewCurrent):CrewCurrent {
  return {...payload,updateToken:crewAssignmentUpdateToken(payload)};
}

/** Read-only daily browsing uses the detector's complete, recent JunkWare feed.
 * It never starts a provider browser or takes a photo/closeout write lock. */
export function crewAssignedDay(phone: CrewPhone, date: string, deps = sources, now = Date.now()): CrewCurrent {
  const snapshot = deps.snapshot(date);
  const age = snapshot ? now - snapshot.freshnessAtMs : Infinity;
  if (!snapshot || snapshot.date !== date || age < 0 || age > 120_000) return withUpdateToken({
    state: 'unavailable', truck: phone.truck, job: null, jobs: [], observedAt: null,
    message: 'Today’s assignments are updating. Try Refresh assignments in a moment.',
  });
  // The verified feed owns membership, truck and status; richer local rows only
  // supply notes/items. An omitted or moved appointment cannot survive a merge.
  const rows = mergeFastScheduleRows(deps.rows(date), snapshot.appointments, snapshot.cancelled, date);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.appointmentId, (counts.get(row.appointmentId) || 0) + 1);
  const overrides = deps.overrides(date);
  const current = deps.dispatch(phone.truck).current;
  const eligible = rows.flatMap(row => {
    const override = overrides.get(`appt:${row.appointmentId}`);
    const verifiedAt=Date.parse(override?.junkwareVerifiedAt || '');
    const newerVerifiedMove=Boolean(override?.junkwareSyncStatus==='verified' && Number.isFinite(verifiedAt) && verifiedAt>snapshot.freshnessAtMs);
    const truck=newerVerifiedMove?override!.truck:row.assignedTruck || row.truck;
    if (!/^\d{1,12}$/.test(row.appointmentId) || counts.get(row.appointmentId) !== 1
      || !sameTruck(truck, phone.truck) || !crewAppointmentStatus(row.status)
      || (override && override.junkwareSyncStatus !== 'verified')) return [];
    return [{...row,truck,assignedTruck:truck,
      ...(newerVerifiedMove && override?.appointmentTime ? {appointmentTime:override.appointmentTime} : {}),
      recordId:`${date}:appointment:${row.appointmentId}`,version:''}];
  });
  const jobs: CrewScheduledJob[] = applyStopOrders(date,eligible).sort(compareStops)
    .map(row => ({
      appointmentId: row.appointmentId, date, jkNumber: row.jkNumber, customerName: row.customerName,
      address: row.address, appointmentTime: row.appointmentTime, junkItems: row.junkItems,
      appointmentNotes: row.appointmentNotes, driver: row.driver, navigator: row.navigator, status: crewAppointmentStatus(row.status)!,
      appointmentType:row.appointmentType,
      ...(crewAppointmentStatus(row.status)==='Completed' ? {
        ...(row.closeout && Number.isFinite(row.closeout.total) ? {closedTotal:row.closeout.total,closeout:{...row.closeout,payments:row.closeout.payments.map(payment=>({method:payment.method,detail:safePaymentDetail(payment.method,payment.detail),amount:payment.amount}))}} : {}),
        ...(/^estimate$/i.test(row.appointmentType) ? {estimateOutcomes:row.appointmentNotes.filter(note=>/^(Price\/Budget|Date\/Time|Other):/i.test(note))} : {}),
      } : {}),
      assignmentId: current?.date === date && current.appointmentId === row.appointmentId
        ? current.assignmentId : crewScheduleAssignmentId(phone.truck,date,row.appointmentId),
    }));
  const active = jobs.find(job => job.assignmentId);
  return withUpdateToken({state: jobs.length ? 'assigned' : 'waiting', truck: phone.truck, observedAt: new Date(snapshot.freshnessAtMs).toISOString(), jobs,
    job: active?.assignmentId ? {...active, assignmentId: active.assignmentId} : null});
}
