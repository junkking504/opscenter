import { NextResponse } from "next/server";
import { preparePodiumReviewAttributionInput, type PodiumAttributionMode } from "@/lib/marketing-control";
import { requestAction } from "@/lib/platform/actions/engine";
import { authenticatedPlatformActor } from "@/lib/platform/request-actor";

export async function POST(request: Request) {
  const actor = await authenticatedPlatformActor();
  if (!actor) {
    return NextResponse.json(
      { ok: false, error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const body = await request.json().catch(() => null);
  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const reviewUid = String(values.reviewUid || "").trim();
  const appointmentReference = String(values.appointmentReference || "").trim();
  const requestedMode = String(values.assignmentMode || "").trim() as PodiumAttributionMode;
  if (!reviewUid || !appointmentReference) {
    return NextResponse.json(
      { ok: false, error: "Select a current review and enter an appointment ID or JK number." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  try {
    const input = preparePodiumReviewAttributionInput(
      reviewUid,
      appointmentReference,
      requestedMode === "confirm_suggestion" || requestedMode === "reassign" ? requestedMode : undefined,
    );
    const result = await requestAction({
      actor,
      actionKey: "marketing.assign_podium_review.v1",
      entity: { type: "review", id: reviewUid, label: `Podium review · ${input.expectedCandidateJkNumber}` },
      rawInput: input,
    });
    return NextResponse.json(
      { ok: true, created: result.created, run: result.run },
      { status: result.created ? 202 : 200, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Podium attribution request could not be prepared.";
    const status = /no completed/i.test(message) ? 404 : /current|choose|valid|required|unavailable/i.test(message) ? 400 : 503;
    return NextResponse.json(
      { ok: false, error: status === 503 ? "The Podium attribution request could not be prepared." : message },
      { status, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
