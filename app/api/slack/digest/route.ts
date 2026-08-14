import { NextResponse } from "next/server";
import { readSlackDailyDigest } from "@/lib/slack-digest";
import { chicagoDateKey } from "@/lib/report-dates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestedDate = new URL(request.url).searchParams.get("date") || "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : chicagoDateKey();
  const digest = await readSlackDailyDigest(date);
  return NextResponse.json(digest, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
