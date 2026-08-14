import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { buildFleetMapPayload } from "@/lib/fleet-map";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const date = new URL(request.url).searchParams.get("date") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "A valid date is required." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const fleet = buildFleetMapPayload(date);
  if (!fleet) {
    return NextResponse.json(
      { error: "Live Linxup GPS is unavailable." },
      { status: 404, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const trucks = fleet.trucks
    .filter((truck) => truck.hasCoordinates && Number.isFinite(truck.latitude) && Number.isFinite(truck.longitude))
    .map((truck) => ({
      truck: truck.truck,
      latitude: truck.latitude as number,
      longitude: truck.longitude as number,
      status: truck.operationalStatus,
      freshness: truck.freshnessLabel,
      lastGpsUpdate: truck.lastGpsUpdate,
      driver: truck.driver,
      navigator: truck.navigator,
      recentPoints: truck.routePoints.slice(-8).map((point) => ({
        timestamp: point.timestamp,
        latitude: point.latitude,
        longitude: point.longitude,
        continuousUntil: point.continuousUntil,
      })),
      routePoints: truck.routePoints.map((point) => ({
        timestamp: point.timestamp,
        latitude: point.latitude,
        longitude: point.longitude,
      })),
      jobStops: truck.routeStops.filter((stop) => stop.kind === "At Job").map((stop) => ({
        label: stop.label,
        latitude: stop.latitude,
        longitude: stop.longitude,
        begin: stop.begin,
        end: stop.end,
      })),
      recentStops: truck.gpsStops.filter((stop) => {
        const begin = Date.parse(stop.begin);
        const end = Date.parse(stop.end);
        return Number.isFinite(begin) && Number.isFinite(end) && end - begin >= 2 * 60_000;
      }).map((stop) => ({
        latitude: stop.latitude,
        longitude: stop.longitude,
        begin: stop.begin,
        end: stop.end,
      })),
    }));

  return NextResponse.json(
    {
      date: fleet.date,
      isToday: fleet.isToday,
      gpsDataStatus: fleet.gpsDataStatus,
      lastUpdatedAt: fleet.lastUpdatedAt,
      trucks,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
