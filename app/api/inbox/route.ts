import { NextResponse } from "next/server";
import { buildInboxPayload } from "@/lib/platform/inbox";
import { createCorrelationId } from "@/lib/platform/identifiers";
import { authenticatedPlatformActor, validOperatingDate } from "@/lib/platform/request-actor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = createCorrelationId();
  try {
    const actor = await authenticatedPlatformActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const date = validOperatingDate(new URL(request.url).searchParams.get("date"));
    return NextResponse.json(await buildInboxPayload(date, actor), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json(
      { error: "The Operating Inbox kernel is unavailable.", correlationId },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
