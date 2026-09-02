import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import {
  createJunkwareAppointment,
  JunkwareAppointmentCreationError,
} from "@/lib/junkware-appointment-creation";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: NO_STORE },
    );
  }

  const body = await request.json().catch(() => null);
  try {
    const creation = await createJunkwareAppointment(body);
    console.info("[appointment-creation] JunkWare verified", {
      requestId: body && typeof body === "object" ? String((body as Record<string, unknown>).requestId || "") : "",
      appointmentId: creation.result.appointmentId,
      jkNumber: creation.result.jkNumber,
      date: creation.result.date,
      franchise: creation.result.franchise,
      replayed: creation.replayed,
    });
    return NextResponse.json({ ok: true, ...creation }, { headers: NO_STORE });
  } catch (error) {
    const failure = error instanceof JunkwareAppointmentCreationError
      ? error
      : new JunkwareAppointmentCreationError(error instanceof Error ? error.message : "JunkWare could not create the appointment.");
    const requestId = body && typeof body === "object" ? String((body as Record<string, unknown>).requestId || "") : "";
    console.warn("[appointment-creation] failed", {
      requestId,
      code: failure.code,
      stage: failure.stage,
      error: failure.message,
    });
    const status = failure.stage === "validation"
      ? 400
      : failure.code === "duplicate_appointment" || failure.code === "request_changed" || failure.code === "verification_required"
        ? 409
        : failure.stage === "preflight"
          ? 422
          : 502;
    return NextResponse.json(
      {
        ok: false,
        error: failure.message,
        code: failure.code,
        stage: failure.stage,
        uncertain: failure.stage === "saving" || failure.stage === "verifying",
      },
      { status, headers: NO_STORE },
    );
  }
}
