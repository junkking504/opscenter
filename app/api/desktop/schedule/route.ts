import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { chicagoDateKey } from '@/lib/report-dates';
import { readDesktopSchedule } from '@/lib/desktop-schedule';
import {requestScheduleDay} from '@/lib/requested-schedule-day';
import { after } from 'next/server';
import { authorizeOpsRequest } from '@/lib/ops-roles';
import { automaticallyCheckMove, scheduleMoveRecovery } from '@/lib/desktop-schedule-operations';
import { withJunkwareAppointmentSyncLock } from '@/lib/job-route-assignments';
import { readJunkwareTruckAssignment } from '@/lib/junkware-truck-assignment';
import {recordNextPickupSourceNote,pickupSourceNoteNotices} from '@/lib/truck-pickup-source-notes';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function GET(request: Request) {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  const date = new URL(request.url).searchParams.get('date') || chicagoDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) {
    return Response.json({ error: 'A valid operating date is required.' }, { status: 400, headers });
  }
  try {
    // Render source truth immediately; the separate routing request verifies addresses.
    const snapshot=readDesktopSchedule(date);
    const params=new URL(request.url).searchParams;
    const sourceRequest=params.get('load')==='1' ? requestScheduleDay(date,snapshot.observedAt,snapshot.appointments.length>0,params.get('refresh')==='1') : undefined;
    const recovery = authorizeOpsRequest(session.role, '/api/job-route-assignments', 'POST').allowed ? await scheduleMoveRecovery(date, session.email) : {candidate: null, notices: []};
    if (recovery.candidate) {
      const id = recovery.candidate;
      after(async () => {
        try { await automaticallyCheckMove(id, session.email, appointmentId => withJunkwareAppointmentSyncLock(appointmentId, () => readJunkwareTruckAssignment(appointmentId))); }
        catch { /* Keep the durable receipt and drag lock if recovery is unavailable. */ }
      });
    }
    if (authorizeOpsRequest(session.role, '/api/job-route-assignments', 'POST').allowed) after(async()=>{
      try { await recordNextPickupSourceNote(date,session.email); }
      catch { /* Source-note receipts preserve uncertain writes across refreshes. */ }
    });
    return Response.json({...snapshot,sourceRequest,assignmentRecoveryNotices:[...recovery.notices,...pickupSourceNoteNotices(date,snapshot.appointments)]}, { headers });
  } catch {
    return Response.json({ error: 'Schedule source unavailable.' }, { status: 503, headers });
  }
}
