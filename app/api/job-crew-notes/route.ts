import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { removeJobCrewNote, saveJobCrewNote } from "@/lib/job-crew-notes";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) return NextResponse.json({ ok: false, error: "Authentication required.", loginPath: "/login" }, { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } });
  const body = await request.json().catch(() => null);
  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const date = String(values.date || "").trim();
  const jobKey = String(values.jobKey || "").trim();
  const appointmentId = String(values.appointmentId || "").trim();
  const note = String(values.note || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,12}$/.test(appointmentId) || jobKey !== `appt:${appointmentId}` || note.length > 2_000) return NextResponse.json({ ok: false, error: "The crew note was not valid." }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } });
  if (!note) return NextResponse.json({ ok: true, removed: removeJobCrewNote({ date, jobKey, appointmentId }) }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  const crewNote = saveJobCrewNote({ date, jobKey, appointmentId, body: note, updatedBy: auth.email });
  if (!crewNote) return NextResponse.json({ ok: false, error: "The crew note could not be saved." }, { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } });
  return NextResponse.json({ ok: true, crewNote }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
