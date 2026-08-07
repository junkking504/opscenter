import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import {
  deleteResaleItem,
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

  return NextResponse.json(readResaleStore(), { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  if (!(await isAuthorized())) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: noStoreHeaders },
    );
  }

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

  const itemId = new URL(request.url).searchParams.get("itemId") || "";
  const deleted = deleteResaleItem(itemId);
  return NextResponse.json(
    { ok: deleted },
    { status: deleted ? 200 : 404, headers: noStoreHeaders },
  );
}
