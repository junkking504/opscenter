import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { readFleetChecklistTemplateStore, upsertFleetChecklistCustomization } from "@/lib/fleet-checklist-templates";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

async function authenticated() {
  const cookieStore = await cookies();
  return verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
}

export async function GET() {
  if (!(await authenticated())) return response({ error: "Authentication required." }, 401);
  return response({ store: readFleetChecklistTemplateStore() });
}

export async function POST(request: Request) {
  if (!(await authenticated())) return response({ error: "Authentication required." }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return response({ error: "Enter a valid checklist template." }, 400);
  const values = body as Record<string, unknown>;
  const customization = upsertFleetChecklistCustomization({
    truck: String(values.truck || ""),
    cadence: String(values.cadence || ""),
    hiddenItemIds: values.hiddenItemIds,
    customItems: values.customItems,
  });
  if (!customization) return response({ error: "Truck and checklist frequency are required." }, 400);
  return response({ ok: true, customization, store: readFleetChecklistTemplateStore() });
}
