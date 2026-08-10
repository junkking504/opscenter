import { NextResponse } from "next/server";
import { createCorrelationId } from "@/lib/platform/identifiers";
import { workItemHistory } from "@/lib/platform/inbox";
import { getWorkItem, mutateWorkItem, type WorkItemMutation } from "@/lib/platform/persistence/work-items";
import { authenticatedPlatformActor } from "@/lib/platform/request-actor";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const correlationId = createCorrelationId();
  try {
    const actor = await authenticatedPlatformActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const { id } = await context.params;
    const item = await getWorkItem(id);
    if (!item) return NextResponse.json({ error: "Work item not found." }, { status: 404 });
    return NextResponse.json({ item, events: await workItemHistory(id) }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json(
      { error: "The work-item history is unavailable.", correlationId },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}

function parseMutation(value: unknown): WorkItemMutation {
  if (!value || typeof value !== "object") throw new Error("A work-item action is required.");
  const body = value as Record<string, unknown>;
  const action = String(body.action || "");
  if (action === "acknowledge" || action === "assign_self" || action === "unassign" || action === "reopen") {
    return { action };
  }
  if (action === "snooze") return { action, until: String(body.until || "") };
  if (action === "dismiss" || action === "resolve_manually") {
    return { action, reason: String(body.reason || "") };
  }
  throw new Error("Unsupported work-item action.");
}

export async function PATCH(request: Request, context: RouteContext) {
  const correlationId = createCorrelationId();
  try {
    const actor = await authenticatedPlatformActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return NextResponse.json({ error: "A valid expectedVersion is required." }, { status: 400 });
    }
    const item = await mutateWorkItem({
      id,
      expectedVersion,
      actorId: actor.id,
      correlationId,
      mutation: parseMutation(body),
    });
    return NextResponse.json({ item, events: await workItemHistory(id) }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown work-item failure.";
    if (message === "WORK_ITEM_VERSION_CONFLICT") {
      return NextResponse.json({ error: "This item changed. Refresh and try again.", correlationId }, { status: 409 });
    }
    if (message === "Work item not found.") {
      return NextResponse.json({ error: message, correlationId }, { status: 404 });
    }
    if (/required|Unsupported|future|transition/i.test(message)) {
      return NextResponse.json({ error: message, correlationId }, { status: 400 });
    }
    return NextResponse.json(
      { error: "The work-item action failed.", correlationId },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
