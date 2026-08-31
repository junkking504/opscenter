import { NextResponse } from "next/server";
import { getActionRun } from "@/lib/platform/persistence/action-runs";
import { authenticatedPlatformActor } from "@/lib/platform/request-actor";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    if (!(await authenticatedPlatformActor())) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const { id } = await context.params;
    const run = await getActionRun(id);
    if (!run) return NextResponse.json({ error: "Action run not found." }, { status: 404 });
    return NextResponse.json({ run }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json(
      { error: "The action run is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
