import { NextResponse } from "next/server";
import { readFinanceControlSnapshot } from "@/lib/finance-control";
import { actorHasPermission } from "@/lib/platform/actions/policy";
import { authenticatedPlatformActor, validOperatingDate } from "@/lib/platform/request-actor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await authenticatedPlatformActor();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!actorHasPermission(actor, "finance.read")) {
    return NextResponse.json({ error: "Finance access requires a manager or administrator." }, { status: 403 });
  }
  const date = validOperatingDate(new URL(request.url).searchParams.get("date"));
  return NextResponse.json(readFinanceControlSnapshot(date), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
