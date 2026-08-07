import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { saveJobCallAheadStatus } from "@/lib/job-call-ahead";

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
  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const date = String(values.date || "").trim();
  const jobKey = String(values.jobKey || "").trim();
  const status = String(values.status || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !jobKey
      || jobKey.length > 500
      || (status !== "called" && status !== "not_called")) {
    return NextResponse.json(
      { ok: false, error: "The call-ahead selection was not valid." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const record = saveJobCallAheadStatus({ date, jobKey, status });
  if (!record) {
    return NextResponse.json(
      { ok: false, error: "The call-ahead status could not be saved." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  return NextResponse.json(
    { ok: true, callAhead: record },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
