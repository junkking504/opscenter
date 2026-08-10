import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildOperationalExceptions } from "@/lib/operational-exceptions";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";

function todayIsoChicago(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

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
  const date = url.searchParams.get("date") || todayIsoChicago();
  const report = buildOperationalExceptions(date);
  return NextResponse.json(report, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
