import { cookies } from "next/headers";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie, opsAuthRole } from "@/lib/auth";
import { opsRoleCan } from "@/lib/ops-roles";
import { JUNKWARE_DISPATCH_TRUCKS } from "@/lib/junkware-trucks";
import { InspectionError, inspectionDate } from "@/lib/truck-inspection";
import { listTruckInspections, createInspectionPairing, listInspectionDevices, revokeInspectionDevice } from "@/lib/truck-inspection-store";
import { inspectionResponse, inspectionFailure, inspectionRequestBody } from "@/lib/truck-inspection-http";
export const runtime = "nodejs";
async function operator() {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || "");
  if (!session) throw new InspectionError("Sign in to OpsCenter.", 401);
  return session;
}
export async function GET(request: Request) {
  try {
    const session = await operator();
    if (!opsRoleCan(opsAuthRole(session.email), "operations.read")) throw new InspectionError("OpsCenter access is required.", 403);
    const date = new URL(request.url).searchParams.get("date") || inspectionDate();
    return inspectionResponse({ date, reports: listTruckInspections(date), trucks: JUNKWARE_DISPATCH_TRUCKS, devices: listInspectionDevices(), canManage: opsRoleCan(opsAuthRole(session.email), "sensitive.write") });
  } catch (error) { return inspectionFailure(error); }
}
export async function POST(request: Request) {
  try {
    const session = await operator();
    if (!opsRoleCan(opsAuthRole(session.email), "sensitive.write")) throw new InspectionError("A manager must set up or remove truck phones.", 403);
    const body = await inspectionRequestBody(request, 10_000);
    if (body.action === "pair") return inspectionResponse(createInspectionPairing(String(body.truck || ""), String(body.label || ""), session.email));
    if (body.action === "revoke") { revokeInspectionDevice(String(body.deviceId || ""), session.email); return inspectionResponse({ ok: true }); }
    throw new InspectionError("Choose a valid phone action.");
  } catch (error) { return inspectionFailure(error); }
}
