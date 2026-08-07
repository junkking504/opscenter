import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";

type CachedAddress = { address: string | null; expiresAt: number };

const addressCache = new Map<string, CachedAddress>();
const CACHE_TTL_MS = 10 * 60_000;
const USER_AGENT = "JunkKing-OpsCenter-FleetMap/1.0";

function validCoordinate(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

async function googleAddress(latitude: number, longitude: number): Promise<string | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_ROUTES_API_KEY;
  if (!key) return null;
  const params = new URLSearchParams({ latlng: `${latitude},${longitude}`, key });
  try {
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return String(payload?.results?.[0]?.formatted_address || "").trim() || null;
  } catch {
    return null;
  }
}

async function openStreetMapAddress(latitude: number, longitude: number): Promise<string | null> {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: "jsonv2",
    addressdetails: "1",
    zoom: "18",
  });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return String(payload?.display_name || "").trim() || null;
  } catch {
    return null;
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

  const cacheKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const cached = addressCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ address: cached.address }, { headers: { "Cache-Control": "private, max-age=300" } });
  }

  const address = await googleAddress(latitude, longitude) || await openStreetMapAddress(latitude, longitude);
  addressCache.set(cacheKey, { address, expiresAt: Date.now() + CACHE_TTL_MS });
  return NextResponse.json(
    { address, coordinates: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
