import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { saveVerifiedJobCancellation } from "@/lib/job-cancellations";
import { withJunkwareAppointmentSyncLock } from "@/lib/job-route-assignments";
import { cancelJunkwareAppointment } from "@/lib/junkware-appointment-cancellation";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: NO_STORE },
    );
  }

  const body = await request.json().catch(() => null);
  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const date = String(values.date || "").trim();
  const appointmentId = String(values.appointmentId || "").trim();
  const jobKey = String(values.jobKey || "").trim();
  const jkNumber = String(values.jkNumber || "").trim().slice(0, 40);
  const customerName = String(values.customerName || "").trim().slice(0, 200);
  const cancellationReason = String(values.cancellationReason || "").trim().slice(0, 500);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !/^\d{1,12}$/.test(appointmentId)
      || jobKey !== `appt:${appointmentId}`
      || !cancellationReason) {
    return NextResponse.json(
      { ok: false, error: "The appointment cancellation was not valid." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const junkware = await withJunkwareAppointmentSyncLock(
      appointmentId,
      () => cancelJunkwareAppointment(appointmentId, cancellationReason),
    );
    const cancellation = saveVerifiedJobCancellation({
      date,
      appointmentId,
      jobKey,
      jkNumber,
      customerName,
      cancellationReason,
      canceledAt: new Date().toISOString(),
      junkwareVerifiedAt: junkware.verifiedAt,
    });
    console.info("[job-cancellation] JunkWare verified", {
      date,
      appointmentId,
      jobKey,
      jkNumber,
      changed: junkware.changed,
    });
    return NextResponse.json(
      { ok: true, junkwareSynced: true, cancellation, junkware },
      { headers: NO_STORE },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The appointment could not be canceled.";
    console.warn("[job-cancellation] failed", { date, appointmentId, jobKey, error: detail });
    const status = /completed appointments cannot/i.test(detail) ? 409 : 502;
    return NextResponse.json(
      { ok: false, error: detail },
      { status, headers: NO_STORE },
    );
  }
}
