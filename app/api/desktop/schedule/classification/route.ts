import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { authorizeOpsRequest } from '@/lib/ops-roles';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { withJunkwareAppointmentSyncLock } from '@/lib/job-route-assignments';
import { junkwareJobCloseout, JunkwareCloseoutError } from '@/lib/junkware-job-closeout';
import { parseClassificationChange, recordAppointmentClassification } from '@/lib/appointment-classification';
export { GET } from '../closeout/route';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({error:'Authentication required.'},{status:401});
  if (!authorizeOpsRequest(actor.role,'/api/job-closeout','POST').allowed || !isDesktopWriteOriginAllowed(request)) return Response.json({error:'This appointment change is not permitted.'},{status:403});
  let validated = false;
  try {
    const body = await request.json();
    const change = parseClassificationChange(body);
    const appointmentId = String(body.appointmentId || ''), date = String(body.date || '');
    if (!/^\d{1,12}$/.test(appointmentId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A valid date and appointment are required.');
    validated = true;
    const result = await withJunkwareAppointmentSyncLock(appointmentId,()=>junkwareJobCloseout(appointmentId,change,'classify'));
    recordAppointmentClassification(date,{appointmentId,appointmentType:result.closeout.appointmentType.label,status:result.closeout.status.label,verifiedAt:result.verifiedAt});
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    const preflight = error instanceof JunkwareCloseoutError && error.stage === 'preflight';
    return Response.json({ok:false,error:error instanceof Error ? error.message : 'The source change could not be verified.'},{status:!validated ? 400 : preflight ? 409 : 502});
  }
}
