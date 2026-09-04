import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { authorizeOpsRequest } from '@/lib/ops-roles';
import { readDesktopSchedule } from '@/lib/desktop-schedule';
import { executeScheduleOperation, parseScheduleOperation, readScheduleReceipt } from '@/lib/desktop-schedule-operations';
import { POST as assign } from '@/app/api/job-route-assignments/route';
import { POST as cancel } from '@/app/api/job-cancellation/route';
import { POST as callAhead } from '@/app/api/job-call-ahead/route';
import { POST as closeout } from '@/app/api/job-closeout/route';
import { POST as note } from '@/app/api/junkware-appointment-note/route';

const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export const dynamic = 'force-dynamic';
const sources = { move: ['/api/job-route-assignments', assign], cancel: ['/api/job-cancellation', cancel], call_ahead: ['/api/job-call-ahead', callAhead], note: ['/api/junkware-appointment-note', note], closeout: ['/api/job-closeout', closeout] } as const;
export async function GET(request: Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  const receipt = await readScheduleReceipt(new URL(request.url).searchParams.get('requestId') || '');
  if (!receipt || receipt.actor !== actor.email) return Response.json({ error: 'Change receipt not found.' }, { status: 404, headers });
  return Response.json({ receipt }, { headers });
}
export async function POST(request: Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!isDesktopWriteOriginAllowed(request)) return Response.json({ error: 'Cross-site changes are not allowed.' }, { status: 403, headers });
  try {
    const operation = parseScheduleOperation(await request.json());
    const [sourcePath, handler] = sources[operation.action];
    if (!authorizeOpsRequest(actor.role, sourcePath, 'POST').allowed) return Response.json({ error: 'Your role does not include this action.' }, { status: 403, headers });
    const receipt = await executeScheduleOperation(operation, actor.email, () => readDesktopSchedule(operation.date).appointments.find(job => job.recordId === operation.recordId), async job => {
      const values = operation.values;
      const payload = operation.action === 'move' ? { truck: String(values.truck || ''), ...(Number.isInteger(values.appointmentStartMinutes) ? { appointmentStartMinutes: values.appointmentStartMinutes, durationHours: values.durationHours } : {}) }
        : operation.action === 'cancel' ? { cancellationReason: String(values.reason || ''), jkNumber: job.jkNumber, customerName: job.customerName }
        : operation.action === 'call_ahead' ? { status: values.called === true ? 'called' : 'not_called' }
        : operation.action === 'closeout' ? { ...values, serviceDate: operation.date } : { note: String(values.note || '') };
      const response = await handler(new Request(new URL(sourcePath, request.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, date: operation.date, appointmentId: job.appointmentId, jobKey: `appt:${job.appointmentId}` }) }));
      return { status: response.status, body: await response.json() };
    });
    return Response.json({ receipt }, { status: receipt.status === 'verified' ? 200 : receipt.status === 'failed' ? 422 : 202, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The appointment operation is unavailable.';
    const conflict = /changed|request ID already|Closed appointments|Canceled appointments|unverified change/.test(message);
    const invalid = /required|too large/.test(message);
    return Response.json({ error: conflict || invalid ? message : 'The appointment operation could not be confirmed. Check the source before retrying.' }, { status: conflict ? 409 : invalid ? 400 : 503, headers });
  }
}
