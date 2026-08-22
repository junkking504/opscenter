import path from "path";
import { NextResponse } from "next/server";
import { readJunkwareFastSchedule } from "@/lib/junkware-fast-schedule";
import { chicagoDateKey } from "@/lib/report-dates";

const OPSBOT_DATA_DIR =
  process.env.OPSBOT_DATA_DIR ||
  path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data");

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedDate = String(searchParams.get("date") || "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : chicagoDateKey();
  const snapshot = readJunkwareFastSchedule(OPSBOT_DATA_DIR, date);

  return NextResponse.json({
    date,
    lastUpdatedAt: snapshot.updatedAt,
    appointmentCount: snapshot.appointments.length,
    cancelledCount: snapshot.cancelled.length,
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
