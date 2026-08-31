import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { assignPodiumReviewToAppointment } from "@/lib/podium-review-assignments";
import { readPodiumGoogleReviewsSnapshot } from "@/lib/podium-reviews";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const body = await request.json().catch(() => null);
  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const reviewUid = String(values.reviewUid || "").trim();
  const appointmentReference = String(values.appointmentReference || "").trim();
  const snapshot = readPodiumGoogleReviewsSnapshot();
  const reviewExists = snapshot?.locations.some((location) =>
    location.reviews.some((review) => review.uid === reviewUid));
  if (!reviewUid || !appointmentReference || !reviewExists) {
    return NextResponse.json(
      { ok: false, error: "Select a current review and enter an appointment ID or JK number." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const assignment = assignPodiumReviewToAppointment({
    reviewUid,
    appointmentReference,
    assignedBy: auth.email,
  });
  if (!assignment) {
    return NextResponse.json(
      { ok: false, error: "No completed JunkWare job with recorded crew matched that appointment ID or JK number." },
      { status: 404, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  console.info("[podium-review-attribution] manually assigned", {
    reviewUid,
    appointmentId: assignment.attribution.appointmentId,
    jkNumber: assignment.attribution.jkNumber,
    assignedBy: auth.email,
  });
  return NextResponse.json(
    { ok: true, assignment },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
