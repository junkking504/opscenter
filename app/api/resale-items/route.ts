import { opsRoleCan } from '@/lib/ops-roles';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import {
  readResaleStore,
  type ResaleItemInput,
  upsertResaleItem,
} from "@/lib/resale-items";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

async function isAuthorized(): Promise<boolean> {
  const cookieStore = await cookies();
  return Boolean(
    await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || ""),
  );
}

export async function GET() {
  if (!(await isAuthorized())) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const { items, updatedAt } = readResaleStore();
  return NextResponse.json({ version: 1, items, updatedAt }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  if (!(await isAuthorized())) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || "");
  if (!actor || !opsRoleCan(actor.role, 'sensitive.write') || !isDesktopWriteOriginAllowed(request)) return NextResponse.json({ error: 'Manager access and same-origin request required.' }, { status: 403, headers: noStoreHeaders });
  const body = await request.json().catch(() => null);
  const item = body && typeof body === "object"
    ? upsertResaleItem(body as ResaleItemInput)
    : null;

  if (!item) {
    return NextResponse.json(
      { ok: false, error: "Item name is required." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  return NextResponse.json({ ok: true, item }, { headers: noStoreHeaders });
}

export async function DELETE(request: Request) {
  if (!(await isAuthorized())) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || "");
  if (!actor || !opsRoleCan(actor.role, 'sensitive.write') || !isDesktopWriteOriginAllowed(request)) return NextResponse.json({ error: 'Manager access and same-origin request required.' }, { status: 403, headers: noStoreHeaders });
  return NextResponse.json({ error: 'Open Capital → Resale to delete with confirmation and restore support.' }, { status: 409, headers: noStoreHeaders });
}
