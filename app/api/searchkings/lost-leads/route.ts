import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import {
  buildSearchKingsView,
  saveLostLeadOverride,
  type LostLeadReason,
  type LostLeadStatus,
} from "@/lib/searchkings";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const body = await request.json().catch(() => null);
  const callId = body && typeof body === "object"
    ? String((body as Record<string, unknown>).callId || "").trim()
    : "";
  const view = buildSearchKingsView();
  if (!view.available || !view.leads.some((lead) => lead.callId === callId)) {
    return NextResponse.json(
      { error: "That SearchKings call is not in the current verified snapshot." },
      { status: 404, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const entry = saveLostLeadOverride({
    callId,
    status: String((body as Record<string, unknown>).status || "") as LostLeadStatus,
    reason: String((body as Record<string, unknown>).reason || "") as LostLeadReason,
    note: String((body as Record<string, unknown>).note || ""),
    franchiseContacted: (body as Record<string, unknown>).franchiseContacted === true,
    updatedBy: auth.email,
  });
  if (!entry) {
    return NextResponse.json(
      { error: "Choose a valid lead status." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  return NextResponse.json(
    { ok: true, entry },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
