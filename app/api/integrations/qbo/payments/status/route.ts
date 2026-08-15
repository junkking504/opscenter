import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { getQboPaymentsStatus } from "@/lib/qbo-payments";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const session = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  return NextResponse.json(getQboPaymentsStatus(), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
