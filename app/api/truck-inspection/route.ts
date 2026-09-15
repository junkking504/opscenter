import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { crewRoster } from "@/lib/crew-auth";
import { inspectionDate, InspectionError } from "@/lib/truck-inspection";
import { INSPECTION_DEVICE_COOKIE, inspectionDevice, pairInspectionPhone, submitTruckInspection, findTruckInspection } from "@/lib/truck-inspection-store";
import { inspectionResponse, inspectionFailure, inspectionRequestBody } from "@/lib/truck-inspection-http";
export const runtime = "nodejs";
async function phone() {
  const device = inspectionDevice((await cookies()).get(INSPECTION_DEVICE_COOKIE)?.value || "");
  if (!device) throw new InspectionError("Set up this truck phone with a code from OpsCenter.", 401);
  return device;
}
export async function GET(request: Request) {
  try {
    const device = await phone();
    const requestId = new URL(request.url).searchParams.get("requestId");
    if (requestId) return inspectionResponse({ report: findTruckInspection(device.deviceId, requestId) });
    return inspectionResponse({ device, date: inspectionDate(), inspectors: crewRoster().filter(m => m.active).map(m => m.employee) });
  } catch (error) { return inspectionFailure(error); }
}
export async function POST(request: Request) {
  try {
    const body = await inspectionRequestBody(request);
    if (body.action === "pair") {
      const { token, device } = pairInspectionPhone(body.code);
      const response = NextResponse.json({ device }, { headers: { "Cache-Control": "no-store, max-age=0" } });
      response.cookies.set(INSPECTION_DEVICE_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: (request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "")) === "https", path: "/", expires: new Date(device.expiresAt) });
      return response;
    }
    const device = await phone();
    if (body.action !== "submit") throw new InspectionError("Choose a valid inspection action.");
    return inspectionResponse({ report: submitTruckInspection(body.report, device) });
  } catch (error) { return inspectionFailure(error); }
}
