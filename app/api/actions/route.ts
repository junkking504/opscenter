import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import {
  readOpsActionStore,
  summarizeOpsActions,
  transitionOpsAction,
  type OpsActionOperation,
} from "@/lib/ops-actions";

export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

async function authenticated() {
  const cookieStore = await cookies();
  return verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
}

export async function GET() {
  if (!(await authenticated())) return response({ error: "Authentication required." }, 401);
  const store = readOpsActionStore();
  return response({ store, summary: summarizeOpsActions(store) });
}

export async function POST(request: Request) {
  const session = await authenticated();
  if (!session) return response({ error: "Authentication required." }, 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const actionId = String(body?.actionId || "").trim();
  const operation = String(body?.operation || "") as OpsActionOperation;
  if (!actionId || !["acknowledge", "snooze", "handle", "reopen"].includes(operation)) {
    return response({ error: "Choose a valid OpsCenter action." }, 400);
  }
  const action = transitionOpsAction({
    actionId,
    operation,
    snoozeMinutes: Number(body?.snoozeMinutes || 60),
    note: String(body?.note || ""),
    actor: { source: "opscenter", id: session.email, label: session.email },
  });
  if (!action) return response({ error: "That OpsCenter action was not found." }, 404);
  const store = readOpsActionStore();
  return response({ ok: true, action, store, summary: summarizeOpsActions(store) });
}
