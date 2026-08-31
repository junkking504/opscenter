import crypto from "crypto";
import fs from "fs";
import path from "path";
import { buildFleetMapPayload } from "@/lib/fleet-map";

type Coordinates = { latitude: number; longitude: number };

type CachedGeocode = {
  latitude: number | null;
  longitude: number | null;
  checkedAt: string;
  source: string;
};

type PrivateGeocodeStore = {
  version: 1;
  updatedAt: string;
  addresses: Record<string, CachedGeocode>;
};

export type JobRouteProximityInput = {
  jobKey: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type JobTruckProximity = {
  miles: number | null;
  travelMinutes: number | null;
  status: "available" | "job_location_unavailable" | "truck_gps_unavailable";
  source: "google_live_traffic" | "estimated";
  gpsFreshness: string;
  gpsUpdatedAt: string | null;
};

export type JobRouteProximityPayload = {
  date: string;
  fleetUpdatedAt: string | null;
  routingProvider: "google_live_traffic" | "estimated";
  routingUpdatedAt: string | null;
  distances: Record<string, Record<string, JobTruckProximity>>;
};

const PRIVATE_CACHE_FILE = path.join(process.cwd(), "data", "job-route-geocodes", "geocodes.json");
const PRIVATE_CACHE_FILE_MODE = process.env.OPSCENTER_RUNTIME === "VPS" ? 0o660 : 0o600;
const RETRY_FAILED_AFTER_MS = 6 * 60 * 60 * 1000;
const GEOCODER_USER_AGENT = "JunkKing-OpsCenter-RoutePlanner/1.0";

function normalizeAddress(value: string): string {
  return String(value || "").replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim().toUpperCase();
}

function addressHash(address: string): string {
  return crypto.createHash("sha256").update(normalizeAddress(address)).digest("hex");
}

function validCoordinates(latitude: unknown, longitude: unknown): Coordinates | null {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null;
  return { latitude: lat, longitude: lng };
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(file)) return null;
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function readTrustedGeocodes(): Record<string, Record<string, unknown>> {
  const candidates = [
    path.join(process.env.OPSBOT_DATA_DIR || "", "cache", "appointment_geocodes.json"),
    path.join(process.cwd(), "data", "cache", "appointment_geocodes.json"),
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data", "cache", "appointment_geocodes.json"),
  ];

  for (const file of candidates) {
    if (!file || !fs.existsSync(file)) continue;
    const payload = readJson(file);
    if (payload?.addresses && typeof payload.addresses === "object") {
      return payload.addresses as Record<string, Record<string, unknown>>;
    }
  }
  return {};
}

function readPrivateStore(): PrivateGeocodeStore {
  const payload = readJson(PRIVATE_CACHE_FILE);
  return {
    version: 1,
    updatedAt: String(payload?.updatedAt || ""),
    addresses: payload?.addresses && typeof payload.addresses === "object"
      ? payload.addresses as Record<string, CachedGeocode>
      : {},
  };
}

function writePrivateStore(newEntries: Record<string, CachedGeocode>): void {
  if (!Object.keys(newEntries).length) return;
  const current = readPrivateStore();
  const store: PrivateGeocodeStore = {
    version: 1,
    updatedAt: new Date().toISOString(),
    addresses: { ...current.addresses, ...newEntries },
  };
  const directory = path.dirname(PRIVATE_CACHE_FILE);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = path.join(directory, `.${path.basename(PRIVATE_CACHE_FILE)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), {
    encoding: "utf8",
    // The VPS container atomically replaces this cache while the host sync
    // user reads it for standby replication. Keep that replacement group-readable.
    mode: PRIVATE_CACHE_FILE_MODE,
  });
  fs.chmodSync(temporaryFile, PRIVATE_CACHE_FILE_MODE);
  fs.renameSync(temporaryFile, PRIVATE_CACHE_FILE);
}

async function geocodeWithCensus(address: string): Promise<Coordinates | null> {
  const params = new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    format: "json",
  });
  try {
    const response = await fetch(`https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?${params}`, {
      headers: { "User-Agent": GEOCODER_USER_AGENT },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const matches = payload?.result?.addressMatches;
    if (!Array.isArray(matches) || matches.length !== 1) return null;
    return validCoordinates(matches[0]?.coordinates?.y, matches[0]?.coordinates?.x);
  } catch {
    return null;
  }
}

async function geocodeWithNominatim(address: string): Promise<Coordinates | null> {
  const params = new URLSearchParams({
    q: address,
    format: "jsonv2",
    addressdetails: "1",
    limit: "2",
    countrycodes: "us",
  });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { "User-Agent": GEOCODER_USER_AGENT },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const results = await response.json();
    if (!Array.isArray(results) || !results.length) return null;
    const top = results[0];
    const kind = String(top?.type || "").toLowerCase();
    if (["city", "town", "village", "postcode", "county", "administrative"].includes(kind)) return null;
    if (results.length > 1) {
      const first = validCoordinates(top?.lat, top?.lon);
      const second = validCoordinates(results[1]?.lat, results[1]?.lon);
      if (!first || !second) return null;
      if (Math.abs(first.latitude - second.latitude) > 0.0011 || Math.abs(first.longitude - second.longitude) > 0.0015) return null;
    }
    return validCoordinates(top?.lat, top?.lon);
  } catch {
    return null;
  }
}

async function resolveJobCoordinates(jobs: JobRouteProximityInput[]): Promise<Map<string, Coordinates | null>> {
  const trusted = readTrustedGeocodes();
  const privateStore = readPrivateStore();
  const results = new Map<string, Coordinates | null>();
  const unresolved: Array<{ jobKey: string; address: string; hash: string }> = [];

  for (const job of jobs) {
    const suppliedCoordinates = validCoordinates(job.latitude, job.longitude);
    if (suppliedCoordinates) {
      results.set(job.jobKey, suppliedCoordinates);
      continue;
    }
    const hash = addressHash(job.address);
    const trustedCoordinates = validCoordinates(trusted[hash]?.latitude, trusted[hash]?.longitude);
    if (trustedCoordinates) {
      results.set(job.jobKey, trustedCoordinates);
      continue;
    }

    const cached = privateStore.addresses[hash];
    const cachedCoordinates = validCoordinates(cached?.latitude, cached?.longitude);
    if (cachedCoordinates) {
      results.set(job.jobKey, cachedCoordinates);
      continue;
    }
    const checkedAt = cached?.checkedAt ? new Date(cached.checkedAt).getTime() : 0;
    if (checkedAt && Date.now() - checkedAt < RETRY_FAILED_AFTER_MS) {
      results.set(job.jobKey, null);
      continue;
    }
    unresolved.push({ ...job, hash });
  }

  const censusResults = await Promise.all(unresolved.map(async (job) => ({
    ...job,
    coordinates: await geocodeWithCensus(job.address),
  })));
  const newCacheEntries: Record<string, CachedGeocode> = {};
  let lastNominatimRequestAt = 0;

  for (const result of censusResults) {
    let coordinates = result.coordinates;
    let source = "US Census Geocoder";
    if (!coordinates) {
      const delay = Math.max(0, 1_100 - (Date.now() - lastNominatimRequestAt));
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      lastNominatimRequestAt = Date.now();
      coordinates = await geocodeWithNominatim(result.address);
      source = "Nominatim/OpenStreetMap";
    }
    results.set(result.jobKey, coordinates);
    newCacheEntries[result.hash] = {
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
      checkedAt: new Date().toISOString(),
      source,
    };
  }

  writePrivateStore(newCacheEntries);
  return results;
}

function normalizeTruck(value: string): string {
  const match = String(value || "").match(/truck\s*#?\s*(\d+)/i);
  return match ? `Truck ${match[1]}` : String(value || "").trim();
}

function distanceMiles(from: Coordinates, to: Coordinates): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latDelta = radians(to.latitude - from.latitude);
  const lngDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(lngDelta / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type GoogleRouteMatrixElement = {
  originIndex?: number;
  destinationIndex?: number;
  distanceMeters?: number;
  duration?: string;
  condition?: string;
  status?: { code?: number; message?: string };
};

function googleRoutesApiKey(): string {
  return String(
    process.env.GOOGLE_MAPS_ROUTES_API_KEY
      || process.env.GOOGLE_MAPS_API_KEY
      || "",
  ).trim();
}

function durationMinutes(value: unknown): number | null {
  const match = String(value || "").match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds / 60)) : null;
}

async function googleTrafficMatrix(
  origins: Coordinates[],
  destinations: Coordinates[],
): Promise<GoogleRouteMatrixElement[] | null> {
  const apiKey = googleRoutesApiKey();
  if (!apiKey || !origins.length || !destinations.length || origins.length * destinations.length > 625) return null;

  try {
    const response = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,distanceMeters,duration",
      },
      body: JSON.stringify({
        origins: origins.map((coordinates) => ({
          waypoint: { location: { latLng: coordinates } },
        })),
        destinations: destinations.map((coordinates) => ({
          waypoint: { location: { latLng: coordinates } },
        })),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      }),
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return Array.isArray(payload) ? payload as GoogleRouteMatrixElement[] : null;
  } catch {
    return null;
  }
}

export async function buildJobRouteProximity(
  date: string,
  jobs: JobRouteProximityInput[],
): Promise<JobRouteProximityPayload> {
  const fleet = buildFleetMapPayload(date);
  const jobCoordinates = await resolveJobCoordinates(jobs);
  const distances: JobRouteProximityPayload["distances"] = {};
  const locatedTrucks = (fleet?.trucks || [])
    .map((truck) => ({
      truck,
      truckName: normalizeTruck(truck.truck),
      coordinates: validCoordinates(truck.latitude, truck.longitude),
    }))
    .filter((entry): entry is typeof entry & { coordinates: Coordinates } => Boolean(entry.coordinates));
  const locatedJobs = jobs
    .map((job) => ({ job, coordinates: jobCoordinates.get(job.jobKey) || null }))
    .filter((entry): entry is typeof entry & { coordinates: Coordinates } => Boolean(entry.coordinates));
  const googleMatrix = await googleTrafficMatrix(
    locatedTrucks.map((entry) => entry.coordinates),
    locatedJobs.map((entry) => entry.coordinates),
  );
  const googleRoutes = new Map<string, { miles: number; travelMinutes: number }>();

  for (const element of googleMatrix || []) {
    const origin = locatedTrucks[Number(element.originIndex || 0)];
    const destination = locatedJobs[Number(element.destinationIndex || 0)];
    const minutes = durationMinutes(element.duration);
    const meters = Number(element.distanceMeters);
    const statusCode = Number(element.status?.code || 0);
    if (!origin || !destination || statusCode || element.condition !== "ROUTE_EXISTS" || !Number.isFinite(meters) || minutes == null) continue;
    googleRoutes.set(`${destination.job.jobKey}|${origin.truckName}`, {
      miles: Number((meters / 1609.344).toFixed(1)),
      travelMinutes: minutes,
    });
  }
  const hasGoogleTraffic = googleRoutes.size > 0;

  for (const job of jobs) {
    distances[job.jobKey] = {};
    const jobLocation = jobCoordinates.get(job.jobKey) || null;
    for (const truck of fleet?.trucks || []) {
      const truckName = normalizeTruck(truck.truck);
      const truckLocation = validCoordinates(truck.latitude, truck.longitude);
      const base = {
        gpsFreshness: String(truck.freshnessLabel || "GPS unavailable"),
        gpsUpdatedAt: truck.lastGpsUpdate || null,
      };
      if (!jobLocation) {
        distances[job.jobKey][truckName] = { ...base, miles: null, travelMinutes: null, status: "job_location_unavailable", source: "estimated" };
      } else if (!truckLocation) {
        distances[job.jobKey][truckName] = { ...base, miles: null, travelMinutes: null, status: "truck_gps_unavailable", source: "estimated" };
      } else {
        const googleRoute = googleRoutes.get(`${job.jobKey}|${truckName}`);
        const miles = googleRoute?.miles ?? Number(distanceMiles(truckLocation, jobLocation).toFixed(1));
        distances[job.jobKey][truckName] = {
          ...base,
          miles,
          travelMinutes: googleRoute?.travelMinutes ?? Math.ceil((miles * 1.2 * 60) / 28 + 5),
          status: "available",
          source: googleRoute ? "google_live_traffic" : "estimated",
        };
      }
    }
  }

  return {
    date,
    fleetUpdatedAt: fleet?.lastUpdatedAt || null,
    routingProvider: hasGoogleTraffic ? "google_live_traffic" : "estimated",
    routingUpdatedAt: hasGoogleTraffic ? new Date().toISOString() : null,
    distances,
  };
}
