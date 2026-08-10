import { NextResponse } from "next/server";
import { buildInboxPayload, reconcileOperatingInbox } from "@/lib/platform/inbox";
import { createCorrelationId } from "@/lib/platform/identifiers";
import { authenticatedPlatformActor, validOperatingDate } from "@/lib/platform/request-actor";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const correlationId = createCorrelationId();
  try {
    const actor = await authenticatedPlatformActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const payload = await request.json().catch(() => ({})) as { date?: string };
    const date = validOperatingDate(payload.date || null);
    const reconciliation = await reconcileOperatingInbox(date, actor.id);
    const inbox = await buildInboxPayload(date, actor);
    return NextResponse.json({ ...inbox, reconciliation }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json(
      { error: "The Operating Inbox could not reconcile current signals.", correlationId },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
