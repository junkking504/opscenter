import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import {
  deletePayrollCorrection,
  payrollCorrectionForEmployee,
  upsertPayrollCorrection,
} from "@/lib/payroll-corrections";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

async function authenticatedUser(): Promise<string | null> {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  return auth?.email || null;
}

export async function GET(request: Request) {
  const user = await authenticatedUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: NO_STORE },
    );
  }

  const url = new URL(request.url);
  const workDate = url.searchParams.get("date") || "";
  const employeeName = url.searchParams.get("employee") || "";
  return NextResponse.json(
    { correction: payrollCorrectionForEmployee(workDate, employeeName) },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  const user = await authenticatedUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: NO_STORE },
    );
  }

  const body = await request.json().catch(() => null);
  const row = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const correction = row
    ? upsertPayrollCorrection({
        employeeName: String(row.employeeName || ""),
        workDate: String(row.workDate || ""),
        clockIn: String(row.clockIn || ""),
        clockOut: String(row.clockOut || ""),
        hourlyRate: Number(row.hourlyRate),
        note: String(row.note || ""),
        updatedBy: user,
      })
    : null;

  if (!correction) {
    return NextResponse.json(
      { error: "Enter a valid clock-in, hourly rate, and correction reason." },
      { status: 400, headers: NO_STORE },
    );
  }

  return NextResponse.json({ ok: true, correction }, { headers: NO_STORE });
}

export async function DELETE(request: Request) {
  const user = await authenticatedUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: NO_STORE },
    );
  }

  const url = new URL(request.url);
  const workDate = url.searchParams.get("date") || "";
  const employeeName = url.searchParams.get("employee") || "";
  const deleted = deletePayrollCorrection(workDate, employeeName, user);
  return NextResponse.json({ ok: deleted }, { status: deleted ? 200 : 404, headers: NO_STORE });
}
