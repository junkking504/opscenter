import { NextResponse } from "next/server";
import { collectSystemSignals } from "@/lib/system-signals";
import { chicagoDateKey } from "@/lib/report-dates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Is the operation actually in good shape?
 *
 * Deliberately separate from /api/health. That endpoint answers "is this
 * service alive and serving correct data", and both a deploy gate
 * (deploy/vps/push-app.sh) and a container healthcheck (deploy/vps/compose.yaml)
 * read it - so it must not go red because a tracker is dark or a review queue is
 * deep, or deploys abort and the container restart-loops.
 *
 * This endpoint answers the question the audit found nobody was asking: are
 * there open critical exceptions, silent trackers, backed-up queues, a filling
 * disk, or a stale backup? Point a human-facing monitor at this one.
 */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("date") || "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : chicagoDateKey();
  const signals = collectSystemSignals(date);

  return NextResponse.json(
    {
      ok: signals.status === "ok",
      status: signals.status,
      date,
      blocking: signals.blocking,
      signals,
    },
    {
      status: signals.status === "critical" ? 503 : 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
