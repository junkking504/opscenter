import { cookies } from "next/headers";
import fs from "fs";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import {
  deleteFleetMaintenanceRecord,
  fleetMaintenancePhotoFilePath,
  readFleetMaintenanceStore,
  upsertFleetMaintenanceRecord,
} from "@/lib/fleet-maintenance";

async function authenticated() {
  const cookieStore = await cookies();
  return verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET() {
  if (!(await authenticated())) return response({ error: "Authentication required." }, 401);
  return response({ store: readFleetMaintenanceStore() });
}

export async function POST(request: Request) {
  if (!(await authenticated())) return response({ error: "Authentication required." }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return response({ error: "Enter a valid maintenance record." }, 400);

  const values = body as Record<string, unknown>;
  const record = upsertFleetMaintenanceRecord({
    recordId: String(values.recordId || ""),
    truck: String(values.truck || ""),
    serviceDate: String(values.serviceDate || ""),
    status: String(values.status || ""),
    serviceType: String(values.serviceType || ""),
    description: String(values.description || ""),
    odometer: values.odometer,
    cost: values.cost,
    vendor: String(values.vendor || ""),
    nextServiceDate: String(values.nextServiceDate || ""),
    nextServiceOdometer: values.nextServiceOdometer,
    notes: String(values.notes || ""),
  });

  if (!record) return response({ error: "Truck, date, and service type are required. Mileage and cost cannot be negative." }, 400);
  return response({ ok: true, record, store: readFleetMaintenanceStore() });
}

export async function DELETE(request: Request) {
  if (!(await authenticated())) return response({ error: "Authentication required." }, 401);
  const recordId = new URL(request.url).searchParams.get("recordId") || "";
  const record = readFleetMaintenanceStore().records.find((candidate) => candidate.recordId === recordId);
  const deleted = deleteFleetMaintenanceRecord(recordId);
  if (deleted) {
    for (const photo of record?.photos || []) {
      const filePath = fleetMaintenancePhotoFilePath(photo);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }
  return response({ ok: deleted, store: readFleetMaintenanceStore() }, deleted ? 200 : 404);
}
