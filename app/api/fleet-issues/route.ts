import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { readFleetIssueStore, upsertFleetIssue } from "@/lib/fleet-issues";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

async function authenticated() {
  const cookieStore = await cookies();
  return verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
}

export async function GET() {
  if (!(await authenticated())) return response({ error: "Authentication required." }, 401);
  return response({ store: readFleetIssueStore() });
}

export async function POST(request: Request) {
  if (!(await authenticated())) return response({ error: "Authentication required." }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return response({ error: "Enter a valid repair issue." }, 400);
  const issue = upsertFleetIssue(body as Record<string, unknown>);
  if (!issue) return response({ error: "Truck and issue title are required. Cost and downtime cannot be negative." }, 400);
  return response({ ok: true, issue, store: readFleetIssueStore() });
}
