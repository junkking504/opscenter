import { NextResponse } from "next/server";
import { buildInboxPayload } from "@/lib/platform/inbox";
import { createCorrelationId } from "@/lib/platform/identifiers";
import { authenticatedPlatformActor, validOperatingDate } from "@/lib/platform/request-actor";
import { createManualWorkItem } from "@/lib/platform/persistence/work-items";
import { parseManualWorkItemRequest } from "@/lib/platform/work-policy";

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

export async function POST(request: Request) {
  const correlationId = createCorrelationId();
  try {
    const actor = await authenticatedPlatformActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const operatingDate = validOperatingDate(String(body.operatingDate || "") || null);
    const input = parseManualWorkItemRequest(body);
    const item = await createManualWorkItem({ operatingDate, ...input }, { actorId: actor.id, correlationId });
    return NextResponse.json({ ...(await buildInboxPayload(operatingDate, actor)), createdId: item.id }, {
      status: 201,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown work-item failure.";
    if (/required|must be|future|within 31 days/i.test(message)) {
      return NextResponse.json({ error: message, correlationId }, { status: 400 });
    }
    return NextResponse.json(
      { error: "The work item could not be created.", correlationId },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
