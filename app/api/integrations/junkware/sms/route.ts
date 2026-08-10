import { NextResponse } from "next/server";
import { recordJunkwareSms, secureTokenMatch } from "@/lib/junkware-sms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "Unauthorized." },
    { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

function bearerToken(request: Request): string {
  const authorization = String(request.headers.get("authorization") || "");
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
}

export async function POST(request: Request) {
  const expectedToken = String(process.env.JUNKWARE_SMS_INGEST_TOKEN || "").trim();
  if (!expectedToken || !secureTokenMatch(bearerToken(request), expectedToken)) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Send a JSON message payload." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const payload = body as Record<string, unknown>;
  const text = String(payload.text || "").trim().slice(0, 4_000);
  if (!text) {
    return NextResponse.json(
      { ok: false, error: "Message text is required." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const suppliedTimestamp = String(payload.receivedAt || "").trim();
  const parsedTimestamp = suppliedTimestamp ? new Date(suppliedTimestamp) : new Date();
  const receivedAt = Number.isNaN(parsedTimestamp.getTime()) ? new Date() : parsedTimestamp;
  const result = recordJunkwareSms({
    messageSid: String(payload.messageId || request.headers.get("idempotency-key") || "").trim(),
    body: text,
    sender: String(payload.sender || "Junk King").trim().slice(0, 200),
    receivedAt,
  });

  return NextResponse.json(
    {
      ok: true,
      duplicate: result.duplicate,
      sequence: result.state.sequence,
      appointmentDates: result.event?.appointmentDates || [],
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
