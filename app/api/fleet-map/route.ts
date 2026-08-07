import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildFleetMapPayload } from "@/lib/fleet-map";
import { resolveDate } from "@/lib/opsData";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  const url = new URL(request.url);
  const date = resolveDate(Object.fromEntries(url.searchParams.entries()));
  const truck = url.searchParams.get("truck");
  const payload = buildFleetMapPayload(date, truck);
  if (!payload) {
    return NextResponse.json({ error: "Fleet map unavailable" }, { status: 404 });
  }
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
