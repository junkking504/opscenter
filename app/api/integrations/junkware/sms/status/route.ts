import { NextResponse } from "next/server";
import { junkwareSmsEventsAfter, secureTokenMatch } from "@/lib/junkware-sms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const expectedToken = String(process.env.JUNKWARE_SMS_REFRESH_TOKEN || "").trim();
  const authorization = String(request.headers.get("authorization") || "");
  const actualToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!expectedToken || !secureTokenMatch(actualToken, expectedToken)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const requestUrl = new URL(request.url);
  const requestedAfter = Number(requestUrl.searchParams.get("after") || 0);
  const after = Number.isSafeInteger(requestedAfter) && requestedAfter >= 0 ? requestedAfter : 0;
  const snapshot = junkwareSmsEventsAfter(after);
  return NextResponse.json(
    {
      ok: true,
      sequence: snapshot.sequence,
      lastReceivedAt: snapshot.lastReceivedAt,
      events: snapshot.events.map((event) => ({
        sequence: event.sequence,
        receivedAt: event.receivedAt,
        kind: event.kind,
        appointmentDates: event.appointmentDates,
      })),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
