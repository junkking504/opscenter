import { NextResponse } from "next/server";
import { decideActionApproval } from "@/lib/platform/actions/engine";
import { authenticatedPlatformActor } from "@/lib/platform/request-actor";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await authenticatedPlatformActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const decision = String(body?.decision || "");
    if (decision !== "approved" && decision !== "denied") {
      return NextResponse.json({ error: "Choose approved or denied." }, { status: 400 });
    }
    const { id } = await context.params;
    const run = await decideActionApproval({
      actor,
      actionRunId: id,
      decision,
      reason: String(body?.reason || ""),
    });
    return NextResponse.json({ run }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown approval failure.";
    const status = /not found/i.test(message) ? 404
      : /required|different manager/i.test(message) ? 403
        : /awaiting approval|pending approval|approved|denied/i.test(message) ? 400
          : 503;
    return NextResponse.json(
      { error: status === 503 ? "The approval decision could not be completed." : message },
      { status, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
