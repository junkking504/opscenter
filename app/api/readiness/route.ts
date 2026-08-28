import { NextResponse } from "next/server";
import { getOperationalReadiness } from "@/lib/operational-readiness";

export const dynamic = "force-dynamic";

export function GET() {
  const readiness = getOperationalReadiness();
  return NextResponse.json(readiness, {
    status: readiness.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
