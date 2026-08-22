import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { classifyJunkwareAssignmentFailure } from "@/lib/junkware-assignment-failure";
import { saveJobRouteAssignment, withJunkwareAppointmentSyncLock } from "@/lib/job-route-assignments";
import { syncJunkwareTruckAssignment } from "@/lib/junkware-truck-assignment";

function formatClock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  return `${String(hour % 12 || 12).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function formatAppointmentTime(startMinutes: number, endMinutes: number): string {
  return `${formatClock(startMinutes)} - ${formatClock(endMinutes)}`;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const body = await request.json().catch(() => null);
  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const date = String(values.date || "").trim();
  const jobKey = String(values.jobKey || "").trim();
  const truck = String(values.truck || "").trim();
  const appointmentId = String(values.appointmentId || "").trim();
  const hasAppointmentStart = Number.isInteger(values.appointmentStartMinutes);
  const appointmentStartMinutes = hasAppointmentStart ? Number(values.appointmentStartMinutes) : undefined;
  const durationHours = hasAppointmentStart && Number.isInteger(values.durationHours)
    ? Number(values.durationHours)
    : 1;
  const appointmentEndMinutes = appointmentStartMinutes === undefined
    ? undefined
    : appointmentStartMinutes + durationHours * 60;
  const appointmentTime = appointmentStartMinutes === undefined || appointmentEndMinutes === undefined
    ? undefined
    : formatAppointmentTime(appointmentStartMinutes, appointmentEndMinutes);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
      || jobKey !== `appt:${appointmentId}`
      || (truck && !/^Truck [1-9]$/.test(truck))
      || (appointmentStartMinutes !== undefined && (
        appointmentStartMinutes < 0
        || appointmentStartMinutes >= 24 * 60
        || appointmentStartMinutes % 60 !== 0
        || durationHours < 1
        || durationHours > 12
        || Number(appointmentEndMinutes) > 24 * 60
      ))) {
    return NextResponse.json(
      { ok: false, error: "The schedule change was not valid." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  // Persist the dispatch decision before calling JunkWare. The local schedule is
  // the operator's source of truth while the external verification is in flight,
  // so a slow or unavailable JunkWare session can never make the block snap back.
  const pendingRecord = saveJobRouteAssignment({
    date,
    jobKey,
    truck,
    appointmentId,
    appointmentTime,
    appointmentStartMinutes,
    appointmentEndMinutes,
    junkwareSyncStatus: "pending",
  });
  if (!pendingRecord) {
    return NextResponse.json(
      { ok: false, error: "The schedule change could not be saved." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
  console.info("[job-route-assignment] persisted", { date, jobKey, appointmentId, truck: truck || "unassigned" });

  let junkware;
  try {
    junkware = await withJunkwareAppointmentSyncLock(appointmentId, () => syncJunkwareTruckAssignment({
      appointmentId,
      truck,
      appointmentStartMinutes,
      durationHours,
    }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "JunkWare could not verify the assignment.";
    const junkwareSyncStatus = classifyJunkwareAssignmentFailure(error);
    const assignment = saveJobRouteAssignment({
      date,
      jobKey,
      truck,
      appointmentId,
      appointmentTime,
      appointmentStartMinutes,
      appointmentEndMinutes,
      junkwareSyncStatus,
      junkwareSyncError: detail,
    }) || pendingRecord;
    console.warn(`[job-route-assignment] JunkWare ${junkwareSyncStatus === "manual_correction" ? "needs manual correction" : "verification pending"}`, {
      date,
      jobKey,
      appointmentId,
      truck: truck || "unassigned",
      error: detail,
    });
    return NextResponse.json(
      {
        ok: true,
        persisted: true,
        junkwareSynced: false,
        assignment,
        warning: junkwareSyncStatus === "manual_correction"
          ? `Saved in OpsCenter. JunkWare rejected this assignment and needs manual correction: ${detail}`
          : `Saved in OpsCenter. JunkWare verification is pending: ${detail}`,
      },
      { status: 202, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const record = saveJobRouteAssignment({
    date,
    jobKey,
    truck,
    appointmentId,
    appointmentTime,
    appointmentStartMinutes,
    appointmentEndMinutes,
    junkwareVerifiedAt: junkware.verifiedAt,
    junkwareSyncStatus: "verified",
  });
  console.info("[job-route-assignment] JunkWare verified", {
    date,
    jobKey,
    appointmentId,
    truck: truck || "unassigned",
    changed: junkware.changed,
  });
  if (!record) {
    return NextResponse.json(
      {
        ok: true,
        persisted: true,
        junkwareSynced: true,
        assignment: pendingRecord,
        warning: "JunkWare was verified. The assignment remains saved in OpsCenter.",
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  return NextResponse.json(
    { ok: true, persisted: true, junkwareSynced: true, assignment: record, junkware },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
