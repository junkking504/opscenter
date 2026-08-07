import { NextResponse } from "next/server";
import { getQboSetupStatus } from "@/lib/qbo-status";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getQboSetupStatus(), {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
