import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { osmAddressJson } from '@/lib/osm-address-transport';

function validCoordinate(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

async function openStreetMapAddress(latitude: number, longitude: number) {
  const params = new URLSearchParams({
    lat: String(Number(latitude.toFixed(5))),
    lon: String(Number(longitude.toFixed(5))),
    format: "jsonv2",
    addressdetails: "1",
    zoom: "18",
  });
  try {
    const result = await osmAddressJson('reverse',params);
    const payload = result.payload as {display_name?:string}|null;
    const address = String(payload?.display_name || "").trim() || null;
    return {address, stale: Boolean(result.stale), ...(!address || result.retryAfterMs ? {retryAfterMs: result.retryAfterMs || 60_000} : {})};
  } catch {
    return {address:null, retryAfterMs:60_000};
  }
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const auth = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required.", loginPath: "/login" },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const body = await request.json().catch(() => null);
  const latitude = validCoordinate(body?.latitude, -90, 90);
  const longitude = validCoordinate(body?.longitude, -180, 180);
  if (latitude == null || longitude == null) {
    return NextResponse.json(
      { error: "Valid truck coordinates are required." },
      { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const result = await openStreetMapAddress(latitude, longitude);
  return NextResponse.json(
    { ...result, coordinates: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
