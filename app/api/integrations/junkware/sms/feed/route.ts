import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { readJunkwareSmsState } from "@/lib/junkware-sms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Authentication required." },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const state = readJunkwareSmsState();
  return NextResponse.json(
    {
      ok: true,
      sequence: state.sequence,
      updatedAt: state.lastReceivedAt,
      messages: [...state.events].reverse().slice(0, 20).map((event) => ({
        sequence: event.sequence,
        receivedAt: event.receivedAt,
        sender: event.sender,
        text: event.text,
        kind: event.kind,
        appointmentDates: event.appointmentDates,
      })),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
