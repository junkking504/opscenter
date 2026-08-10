import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { withJobRouteAssignmentSyncLock } from "@/lib/job-route-assignments";
import { junkwareJobCloseout } from "@/lib/junkware-job-closeout";

async function authenticated() {
  const cookieStore = await cookies();
  return verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
}
function appointmentId(request: Request, body?: Record<string, unknown>) {
  return String(body?.appointmentId || new URL(request.url).searchParams.get("appointmentId") || "").trim();
}

export async function GET(request: Request) {
  if (!(await authenticated())) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const id = appointmentId(request);
  if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "The appointment is unavailable." }, { status: 400 });
  try {
    const result = await withJobRouteAssignmentSyncLock(() => junkwareJobCloseout(id));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "JunkWare could not load the closeout." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!(await authenticated())) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = await request.json().catch(() => null);
  const body = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const id = appointmentId(request, body);
  if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "The appointment is unavailable." }, { status: 400 });
  try {
    const { appointmentId: _ignored, ...payload } = body;
    const result = await withJobRouteAssignmentSyncLock(() => junkwareJobCloseout(id, payload));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "JunkWare could not save the closeout." }, { status: 502 });
  }
}
