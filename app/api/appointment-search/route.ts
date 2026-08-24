import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { searchJunkwareAppointments } from "@/lib/junkware-appointment-search";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
const MAX_FIELD_LENGTH = 120;

function field(values: Record<string, unknown>, key: string): string {
  return String(values[key] || "").trim().slice(0, MAX_FIELD_LENGTH);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: NO_STORE },
    );
  }

  const body = await request.json().catch(() => null);
  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const query = {
    startDate: field(values, "startDate"),
    endDate: field(values, "endDate"),
    appointmentType: field(values, "appointmentType"),
    status: field(values, "status"),
    jkNumber: field(values, "jkNumber"),
    firstName: field(values, "firstName"),
    lastName: field(values, "lastName"),
    company: field(values, "company"),
    email: field(values, "email"),
    phone: field(values, "phone"),
    address: field(values, "address"),
    checkNumber: field(values, "checkNumber"),
    followupStartDate: field(values, "followupStartDate"),
    followupEndDate: field(values, "followupEndDate"),
    poNumber: field(values, "poNumber"),
    franchise: field(values, "franchise"),
  };

  if (!Object.values(query).some(Boolean)) {
    return NextResponse.json(
      { ok: false, error: "Enter at least one search field." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const response = await searchJunkwareAppointments(query);
    console.info("[appointment-search]", { by: auth.email, resultCount: response.results.length });
    return NextResponse.json({ ok: true, ...response }, { headers: NO_STORE });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The appointment search could not be completed.";
    console.warn("[appointment-search] failed", { by: auth.email, error: detail });
    return NextResponse.json(
      { ok: false, error: detail },
      { status: 502, headers: NO_STORE },
    );
  }
}
