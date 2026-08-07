import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { readFleetChecklistStore, upsertFleetChecklist } from "@/lib/fleet-checklists";
import { syncFleetIssuesFromChecklist } from "@/lib/fleet-issues";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

async function session() {
  const cookieStore = await cookies();
  return verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
}

export async function GET() {
  if (!(await session())) return response({ error: "Authentication required." }, 401);
  return response({ store: readFleetChecklistStore() });
}

export async function POST(request: Request) {
  const authSession = await session();
  if (!authSession) return response({ error: "Authentication required." }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return response({ error: "Enter a valid truck checklist." }, 400);

  const values = body as Record<string, unknown>;
  const entry = upsertFleetChecklist({
    truck: String(values.truck || ""),
    cadence: String(values.cadence || ""),
    inspectionDate: String(values.inspectionDate || ""),
    inspector: String(values.inspector || ""),
    odometer: values.odometer,
    answers: values.answers,
    submittedByEmail: authSession.email,
  });
  if (!entry) return response({ error: "Truck, date, and checklist frequency are required. Odometer cannot be negative." }, 400);
  const issueStore = syncFleetIssuesFromChecklist(entry);
  return response({ ok: true, entry, store: readFleetChecklistStore(), issueStore });
}
