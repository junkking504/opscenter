import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import {
  readTruckLoadStatuses,
  resetTruckLoad,
  setTruckStartingLoad,
  type TruckLoadResetLocation,
} from "@/lib/truck-load-status";

export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
  if (!(await session())) return response({ error: "Authentication required." }, 401);
  const url = new URL(request.url);
  const date = String(url.searchParams.get("date") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return response({ error: "A valid date is required." }, 400);
  const trucks = url.searchParams.getAll("truck");
  return response({ date, statuses: readTruckLoadStatuses(date, trucks) });
}

export async function POST(request: Request) {
  const authSession = await session();
  if (!authSession) return response({ error: "Authentication required." }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return response({ error: "Enter a valid truck load update." }, 400);
  const values = body as Record<string, unknown>;
  const action = String(values.action || "").trim();

  try {
    const status = action === "set_start"
      ? setTruckStartingLoad({
        date: String(values.date || ""),
        truck: String(values.truck || ""),
        loadFraction: values.loadFraction,
        recordedBy: authSession.email,
      })
      : action === "reset"
        ? resetTruckLoad({
          date: String(values.date || ""),
          truck: String(values.truck || ""),
          location: String(values.location || "") as TruckLoadResetLocation,
          recordedBy: authSession.email,
        })
        : null;
    if (!status) return response({ error: "Choose a starting-load or yard-reset action." }, 400);
    return response({ ok: true, status });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "The truck load status could not be saved." }, 400);
  }
}
