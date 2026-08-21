import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { withJunkwareAppointmentSyncLock } from "@/lib/job-route-assignments";
import { addJunkwareAppointmentNote, validJunkwareAppointmentNote } from "@/lib/junkware-appointment-note";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const body = await request.json().catch(() => null);
  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const appointmentId = String(values.appointmentId || "").trim();
  let note = "";
  try {
    note = validJunkwareAppointmentNote(values.note);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "The appointment note was not valid." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
  if (!/^\d{1,12}$/.test(appointmentId)) {
    return NextResponse.json(
      { ok: false, error: "The JunkWare appointment is unavailable." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  try {
    const junkware = await withJunkwareAppointmentSyncLock(appointmentId, () => addJunkwareAppointmentNote({ appointmentId, note }));
    return NextResponse.json(
      { ok: true, junkware },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "JunkWare could not save the appointment note.";
    console.warn("[junkware-appointment-note] failed", { appointmentId, error: detail });
    return NextResponse.json(
      { ok: false, error: detail },
      { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
