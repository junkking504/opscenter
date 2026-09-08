import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { readSlackDailyDigest } from "@/lib/slack-digest";
import { chicagoDateKey } from "@/lib/report-dates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  // Middleware already default-denies this path, but every sibling route also
  // verifies the session itself. Relying on a single allow-list means one edit
  // to that list silently exposes the day's Slack traffic with no second line
  // of defence.
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const requestedDate = new URL(request.url).searchParams.get("date") || "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : chicagoDateKey();
  const digest = await readSlackDailyDigest(date);
  return NextResponse.json(digest, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
