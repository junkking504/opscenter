import { NextResponse } from "next/server";
import { buildGlobalSearchResults } from "@/lib/global-search";
import { validOperatingDate } from "@/lib/platform/request-actor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "").trim().slice(0, 120);
  const date = validOperatingDate(url.searchParams.get("date"));
  const results = query.length >= 2 ? buildGlobalSearchResults(query, date) : [];
  return NextResponse.json(
    { query, date, results },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
