import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  deleteManualBonusEntry,
  manualBonusEntriesForEmployee,
  readManualBonusStore,
  summarizeManualBonusesForDate,
  upsertManualBonusEntry,
} from "@/lib/manual-bonuses";
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
  const employeeName = url.searchParams.get("employee") || "";

  if (employeeName) {
    return NextResponse.json(
      {
        date,
        employeeName,
        entries: manualBonusEntriesForEmployee(date, employeeName),
        summary: summarizeManualBonusesForDate(date),
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  return NextResponse.json(
    {
      date,
      store: readManualBonusStore(),
      summary: summarizeManualBonusesForDate(date),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => null);
  const entry = body && typeof body === "object"
    ? upsertManualBonusEntry({
        entryId: String((body as Record<string, unknown>).entryId || ""),
        employeeName: String((body as Record<string, unknown>).employeeName || ""),
        workDate: String((body as Record<string, unknown>).workDate || ""),
        amount: Number((body as Record<string, unknown>).amount ?? 0),
        note: String((body as Record<string, unknown>).note || ""),
      })
    : null;

  if (!entry) {
    return NextResponse.json(
      { ok: false, entry: null },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      entry,
      summary: summarizeManualBonusesForDate(entry.workDate),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

export async function DELETE(request: Request) {
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
  const entryId = url.searchParams.get("entryId") || "";
  const deleted = deleteManualBonusEntry(entryId);
  const date = url.searchParams.get("date") || todayIsoChicago();

  return NextResponse.json(
    {
      ok: deleted,
      summary: summarizeManualBonusesForDate(date),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
