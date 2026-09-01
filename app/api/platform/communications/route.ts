import { NextResponse } from "next/server";
import { readCommunicationsControlSnapshot } from "@/lib/communications-control";
import { authenticatedPlatformActor, validOperatingDate } from "@/lib/platform/request-actor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await authenticatedPlatformActor();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const date = validOperatingDate(new URL(request.url).searchParams.get("date"));
  return NextResponse.json(readCommunicationsControlSnapshot(date), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
