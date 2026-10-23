import { waypointManagerActor } from '@/lib/waypoint-manager-context';
import { authorizeOpsRequest } from '@/lib/ops-roles';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { cookies } from "next/headers";
import {NextResponse} from 'next/server';
import {trackedAfter as after} from '@/lib/release-after';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { withJunkwareAppointmentSyncLock } from "@/lib/job-route-assignments";
import { junkwareJobCloseout, opscenterJobCloseout, JunkwareCloseoutError } from "@/lib/junkware-job-closeout";
import { publishVerifiedCloseout } from "@/lib/publish-closeout";
import { updateVerifiedCloseoutLoad } from "@/lib/truck-load-closeouts";

async function authenticated(request:Request) {
  const cookieStore = await cookies();
  return await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "") || waypointManagerActor(request);
}
function appointmentId(request: Request, body?: Record<string, unknown>) {
  return String(body?.appointmentId || new URL(request.url).searchParams.get("appointmentId") || "").trim();
}

export async function GET(request: Request) {
  if (!(await authenticated(request))) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const id = appointmentId(request);
  if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "The appointment is unavailable." }, { status: 400 });
  try {
    const result = await withJunkwareAppointmentSyncLock(id, () => junkwareJobCloseout(id));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "JunkWare could not load the closeout." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const authSession = await authenticated(request);
  if (!authSession) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!authorizeOpsRequest(authSession.role, "/api/job-closeout", "POST").allowed) return NextResponse.json({ error: "Your role does not include this action." }, { status: 403 });
  if (!isDesktopWriteOriginAllowed(request)) return NextResponse.json({ ok: false, error: "Same-origin request required.", stage: "preflight" }, { status: 403 });
  const parsed = await request.json().catch(() => null);
  const body = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const id = appointmentId(request, body);
  if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "The appointment is unavailable." }, { status: 400 });
  try {
    const { appointmentId: _ignored, serviceDate: _serviceDate, ...payload } = body;
    const manager=waypointManagerActor(request);
    if(manager && (payload.targetStatus!=='1' || payload.addPayment!=null || payload.application!==undefined || payload.requirePhotos!==undefined))return NextResponse.json({error:'Use the photo-protected crew workflow for completion and collected payments.'},{status:403});
    const result = await withJunkwareAppointmentSyncLock(id, async () => {
      if(manager){
        const baseline=await junkwareJobCloseout(id);
        if(baseline.closeout.status?.value!=='1')throw new JunkwareCloseoutError('Only open appointments can be edited here.','preflight');
        waypointManagerActor(request); // Recheck phone/role after the source read.
      }
      return opscenterJobCloseout(id, payload);
    });
    const closeout = result && typeof result === "object" && "closeout" in result && result.closeout && typeof result.closeout === "object"
      ? result.closeout as Record<string, unknown>
      : {};
    if ((closeout.status as { value?: string })?.value !== '8') return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
    let truckLoadStatus;
    try { truckLoadStatus = updateVerifiedCloseoutLoad(String(_serviceDate || ""), id, closeout, String((result as Record<string, unknown>).verifiedAt || ""), authSession.email); }
    catch { truckLoadStatus = { updated:false, reason:'Closeout saved; truck load reconciliation is pending.' }; }
    after(async () => { await publishVerifiedCloseout(result as Record<string, unknown>, id); });
    return NextResponse.json({ ...result, truckLoadStatus, slackNotification: { status:'pending' } }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const preflight = error instanceof JunkwareCloseoutError && error.stage === "preflight";
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "JunkWare could not save the closeout.", stage: preflight ? "preflight" : "uncertain", code: error instanceof JunkwareCloseoutError ? error.code : "closeout_unavailable" }, { status: preflight ? 409 : 502 });
  }
}
