import { NextResponse } from "next/server";
import { requestAction } from "@/lib/platform/actions/engine";
import { authenticatedPlatformActor, validOperatingDate } from "@/lib/platform/request-actor";
import { prepareSearchKingsRecoveryInput } from "@/lib/searchkings-control";
import type { LostLeadReason } from "@/lib/searchkings";

export async function POST(request: Request) {
  const actor = await authenticatedPlatformActor();
  if (!actor) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const body = await request.json().catch(() => null);
  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const date = validOperatingDate(String(values.date || "") || null);
  const callId = String(values.callId || "").trim();
  try {
    const input = prepareSearchKingsRecoveryInput(date, callId, {
      status: String(values.status || "") as "needs_follow_up" | "lost" | "unqualified",
      reason: String(values.reason || "") as LostLeadReason,
      owner: String(values.owner || ""),
      nextAction: String(values.nextAction || values.note || ""),
      evidenceNote: String(values.evidenceNote || ""),
      franchiseContacted: values.franchiseContacted === true,
    });
    const result = await requestAction({
      actor,
      actionKey: "marketing.record_searchkings_recovery.v1",
      entity: { type: "lead", id: input.callId, label: "SearchKings recovery lead" },
      rawInput: input,
    });
    return NextResponse.json(
      { ok: true, created: result.created, run: result.run },
      { status: result.created ? 202 : 200, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The SearchKings recovery request could not be prepared.";
    const status = /not in|no longer/i.test(message) ? 404 : /required|valid|choose|contact|current verified/i.test(message) ? 400 : 503;
    return NextResponse.json(
      { ok: false, error: status === 503 ? "The SearchKings recovery request could not be prepared." : message },
      { status, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
