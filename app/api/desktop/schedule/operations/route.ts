import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { cookies } from 'next/headers';
import { after } from 'next/server';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { CrewPhoneError } from '@/lib/crew-phone';
import { authorizeOpsRequest } from '@/lib/ops-roles';
import { readDesktopSchedule } from '@/lib/desktop-schedule';
import { finishScheduleCrewAssignment, automaticallyCheckMove, executeScheduleOperation, parseScheduleOperation, readScheduleReceipt, reconcileCloseoutReceipt, reconcileMoveReceipt, PendingScheduleOperationError } from '@/lib/desktop-schedule-operations';
import { readJunkwareTruckAssignment } from '@/lib/junkware-truck-assignment';
import { rescheduleAppointment } from '@/lib/appointment-reschedule';
import { reconcileRescheduleReceipt, reconcileStaleRescheduleForAppointment, assertRecoveredScheduleMatches } from '@/lib/desktop-schedule-operations';
import { withJunkwareAppointmentSyncLock } from '@/lib/job-route-assignments';
import { junkwareJobCloseout } from '@/lib/junkware-job-closeout';
import { POST as assign } from '@/app/api/job-route-assignments/route';
import { POST as cancel } from '@/app/api/job-cancellation/route';
import { POST as callAhead } from '@/app/api/job-call-ahead/route';
import { POST as closeout } from '@/app/api/job-closeout/route';
import { POST as classify } from '@/app/api/desktop/schedule/classification/route';
import { POST as note } from '@/app/api/junkware-appointment-note/route';

const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export const dynamic = 'force-dynamic';
const sources = { move: ['/api/job-route-assignments', assign], cancel: ['/api/job-cancellation', cancel], call_ahead: ['/api/job-call-ahead', callAhead], note: ['/api/junkware-appointment-note', note], closeout: ['/api/job-closeout', closeout], classify: ['/api/job-closeout', classify] } as const;
function checkMoveAfterResponse(requestId: string, actor: string) {
  after(async () => {
    try { await automaticallyCheckMove(requestId, actor, id => withJunkwareAppointmentSyncLock(id, () => readJunkwareTruckAssignment(id))); await finishScheduleCrewAssignment(requestId, actor); }
    catch { /* Preserve the durable receipt; later reads can recover without replaying the move. */ }
  });
}
export async function GET(request: Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  const parameters = new URL(request.url).searchParams;
  const requestId = parameters.get('requestId') || '';
  let receipt = parameters.get('reconcile') === '1' ? await reconcileCloseoutReceipt(requestId, actor.email, async id => {
    const result = await withJunkwareAppointmentSyncLock(id, () => junkwareJobCloseout(id));
    return result.closeout;
  }) : await readScheduleReceipt(requestId);
  if (parameters.get('reconcile') === '1' && receipt?.actor === actor.email && receipt.action === 'move' && authorizeOpsRequest(actor.role, '/api/job-route-assignments', 'POST').allowed) {
    receipt = await reconcileMoveReceipt(requestId, actor.email, id => withJunkwareAppointmentSyncLock(id, () => readJunkwareTruckAssignment(id)));
  }
  if (!receipt || receipt.actor !== actor.email) return Response.json({ error: 'Change receipt not found.' }, { status: 404, headers });
  if (parameters.get('reconcile') !== '1' && receipt.action === 'move' && authorizeOpsRequest(actor.role, '/api/job-route-assignments', 'POST').allowed) {
    if (receipt.status === 'uncertain') checkMoveAfterResponse(requestId, actor.email);
  }
  if(parameters.get('reconcile')==='1' && ['reschedule','restore'].includes(receipt.action) && authorizeOpsRequest(actor.role,'/api/job-route-assignments','POST').allowed) receipt=await reconcileRescheduleReceipt(requestId,actor.email,id=>withJunkwareAppointmentSyncLock(id,()=>readJunkwareTruckAssignment(id)));
  if (receipt?.crewAssignment && authorizeOpsRequest(actor.role,'/api/crew-dispatch','POST').allowed) receipt = await finishScheduleCrewAssignment(requestId, actor.email);
  return Response.json({ receipt }, { headers });
}
export async function POST(request: Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!isDesktopWriteOriginAllowed(request)) return Response.json({ error: 'Cross-site changes are not allowed.' }, { status: 403, headers });
  try {
    const operation = parseScheduleOperation(await request.json());
    const [sourcePath, handler] = sources[operation.action === 'reschedule' || operation.action === 'restore' ? 'move' : operation.action];
    if (!authorizeOpsRequest(actor.role, sourcePath, 'POST').allowed) return Response.json({ error: 'Your role does not include this action.' }, { status: 403, headers });
    const recovered = await reconcileStaleRescheduleForAppointment(operation.recordId, actor.email, id => withJunkwareAppointmentSyncLock(id, () => readJunkwareTruckAssignment(id)));
    let receipt = await executeScheduleOperation(operation, actor.email, () => {
      const job=readDesktopSchedule(operation.date).appointments.find(job => job.recordId === operation.recordId);
      assertRecoveredScheduleMatches(job,operation.date,recovered);
      return job;
    }, async job => {
      if(['reschedule','restore'].includes(operation.action)) return rescheduleAppointment(job,operation.date,operation.values,operation.action==='restore');
      const values = operation.values;
      const payload = operation.action === 'move' ? { truck: String(values.truck || ''), ...(Number.isInteger(values.appointmentStartMinutes) ? { appointmentStartMinutes: values.appointmentStartMinutes, durationHours: values.durationHours } : {}) }
        : operation.action === 'cancel' ? { cancellationReason: String(values.reason || ''), jkNumber: job.jkNumber, customerName: job.customerName }
        : operation.action === 'call_ahead' ? { status: values.called === true ? 'called' : 'not_called' }
        : ['closeout','classify'].includes(operation.action) ? { ...values, serviceDate: operation.date } : { note: String(values.note || '') };
      const response = await handler(new Request(new URL(sourcePath, request.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, date: operation.date, appointmentId: job.appointmentId, jobKey: `appt:${job.appointmentId}` }) }));
      return { status: response.status, body: await response.json() };
    });
    if (receipt.crewAssignment) receipt = await finishScheduleCrewAssignment(receipt.requestId, actor.email) || receipt;
    if (receipt.action === 'move' && receipt.status === 'uncertain') checkMoveAfterResponse(receipt.requestId, actor.email);
    return Response.json({ receipt }, { status: receipt.status === 'verified' ? 200 : receipt.status === 'failed' ? 422 : 202, headers });
  } catch (error) {
    if (error instanceof CrewPhoneError) return Response.json({error:error.message},{status:error.status,headers});
    if (error instanceof PendingScheduleOperationError) {
      return Response.json({ error: error.message, ...(error.receipt.actor === actor.email ? { receipt: error.receipt } : {}) }, { status: 409, headers });
    }
    const message = error instanceof Error ? error.message : 'The appointment operation is unavailable.';
    const conflict = /changed|request ID already|Closed appointments|Canceled appointments|unverified change/.test(message);
    const invalid = /required|too large/.test(message);
    return Response.json({ error: conflict || invalid ? message : 'The appointment operation could not be confirmed. Check the source before retrying.' }, { status: conflict ? 409 : invalid ? 400 : 503, headers });
  }
}
