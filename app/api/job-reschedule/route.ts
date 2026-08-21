import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { withJunkwareAppointmentSyncLock } from "@/lib/job-route-assignments";
import { rescheduleJunkwareAppointment } from "@/lib/junkware-appointment-reschedule";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) return NextResponse.json({ error: "Authentication required.", loginPath: "/login" }, { status: 401, headers: NO_STORE });

  const body = await request.json().catch(() => null);
  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const appointmentId = String(values.appointmentId || "").trim();
  const jobKey = String(values.jobKey || "").trim();
  const date = String(values.date || "").trim();
  const appointmentStartMinutes = Number(values.appointmentStartMinutes);
  if (!/^\d{1,12}$/.test(appointmentId) || jobKey !== `appt:${appointmentId}` || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(appointmentStartMinutes) || appointmentStartMinutes < 0 || appointmentStartMinutes >= 24 * 60 || appointmentStartMinutes % 60 !== 0) {
    return NextResponse.json({ ok: false, error: "The appointment reschedule was not valid." }, { status: 400, headers: NO_STORE });
  }

  try {
    const junkware = await withJunkwareAppointmentSyncLock(appointmentId, () => rescheduleJunkwareAppointment({ appointmentId, date, appointmentStartMinutes }));
    console.info("[job-reschedule] JunkWare verified", { appointmentId, jobKey, date, appointmentStartMinutes, changed: junkware.changed });
    return NextResponse.json({ ok: true, junkwareSynced: true, junkware }, { headers: NO_STORE });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The appointment could not be rescheduled.";
    console.warn("[job-reschedule] failed", { appointmentId, jobKey, date, appointmentStartMinutes, error: detail });
    return NextResponse.json({ ok: false, error: detail }, { status: 502, headers: NO_STORE });
  }
}
