import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { JUNKWARE_DISPATCH_TRUCKS } from "@/lib/junkware-trucks";
import { inspectionDate, InspectionError } from "@/lib/truck-inspection";
import { INSPECTION_DEVICE_COOKIE, inspectionDevice, connectInspectionPhone, pairInspectionPhone, submitTruckInspection, findTruckInspection } from "@/lib/truck-inspection-store";
import { inspectionResponse, inspectionFailure, inspectionRequestBody } from "@/lib/truck-inspection-http";
export const runtime = "nodejs";
async function phone() {
  const device = inspectionDevice((await cookies()).get(INSPECTION_DEVICE_COOKIE)?.value || "");
  if (!device) throw new InspectionError("Reconnect this phone to continue.", 401);
  return device;
}
export async function GET(request: Request) {
  try {
    const requestId = new URL(request.url).searchParams.get("requestId");
    const device = inspectionDevice((await cookies()).get(INSPECTION_DEVICE_COOKIE)?.value || "");
    if (!device && !requestId) return inspectionResponse({ device: null, trucks: JUNKWARE_DISPATCH_TRUCKS });
    if (!device) throw new InspectionError("Reconnect this phone to continue.", 401);
    if (requestId) return inspectionResponse({ report: findTruckInspection(device.deviceId, requestId) });
    return inspectionResponse({ device, trucks: JUNKWARE_DISPATCH_TRUCKS, date: inspectionDate(), inspectors: [] });
  } catch (error) { return inspectionFailure(error); }
}
export async function POST(request: Request) {
  try {
    const body = await inspectionRequestBody(request);
    if (body.action === "connect" || body.action === "pair") {
      const existingToken = (await cookies()).get(INSPECTION_DEVICE_COOKIE)?.value || "";
      const existing = inspectionDevice(existingToken);
      if (existing) {
        if (body.action !== "connect") throw new InspectionError("This phone is already connected.", 409);
        return inspectionResponse({ device: existing });
      }
      const { token, device } = body.action === "connect" ? connectInspectionPhone(body.connectionToken) : pairInspectionPhone(body.code);
      const response = NextResponse.json({ device }, { headers: { "Cache-Control": "no-store, max-age=0" } });
      response.cookies.set(INSPECTION_DEVICE_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: (request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "")) === "https", path: "/", expires: new Date(device.expiresAt) });
      return response;
    }
    const device = await phone();
    if (body.action !== "submit") throw new InspectionError("Choose a valid inspection action.");
    return inspectionResponse({ report: submitTruckInspection(body.report, device) });
  } catch (error) { return inspectionFailure(error); }
}
