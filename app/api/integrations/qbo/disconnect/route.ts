import { NextResponse } from "next/server";
import { clearQboTokenStore } from "@/lib/qbo-token-store";
import { getQboSetupStatus } from "@/lib/qbo-status";

export const dynamic = "force-dynamic";

export function GET() {
  clearQboTokenStore();
  return NextResponse.json(
    {
      ok: true,
      message: "QBO token store cleared.",
      status: getQboSetupStatus(),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export function POST() {
  return GET();
}
