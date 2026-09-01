import { NextResponse } from "next/server";
import { authenticatedPlatformActor, validOperatingDate } from "@/lib/platform/request-actor";
import { readSearchKingsControlSnapshot } from "@/lib/searchkings-control";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await authenticatedPlatformActor();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const date = validOperatingDate(new URL(request.url).searchParams.get("date"));
  return NextResponse.json(readSearchKingsControlSnapshot(date), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
