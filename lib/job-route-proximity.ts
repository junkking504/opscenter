import { verifyDesktopAddress } from './desktop-address-verification';
import { planningLocation } from './planning-geocodes';
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { buildFleetMapPayload } from "@/lib/fleet-map";
import {osmTravelMatrix} from "./osm-travel-matrix";

export type Coordinates = { latitude: number; longitude: number };

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
  status: "available" | "job_location_unavailable" | "truck_gps_unavailable" | "routing_unavailable";
  source: "osm_road_estimate" | "estimated";
  gpsFreshness: string;
  gpsUpdatedAt: string | null;
};

export type JobRouteProximityPayload = {
  date: string;
  fleetUpdatedAt: string | null;
  routingProvider: "osm_road_estimate" | "estimated";
  routingUpdatedAt: string | null;
  distances: Record<string, Record<string, JobTruckProximity>>;
};

const PRIVATE_CACHE_FILE = path.join(process.cwd(), "data", "job-route-geocodes", "geocodes.json");
const PRIVATE_CACHE_FILE_MODE = process.env.OPSCENTER_RUNTIME === "VPS" ? 0o660 : 0o600;
const RETRY_FAILED_AFTER_MS = 6 * 60 * 60 * 1000;

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
    const trustedCoordinates = planningLocation(job.address,trusted);
    if (trustedCoordinates) {
      results.set(job.jobKey, trustedCoordinates);
      continue;
    }

    const cached = privateStore.addresses[hash];
    const cachedCoordinates = cached?.source === 'Verified full address / Census' ? validCoordinates(cached.latitude,cached.longitude) : null;
    if (cachedCoordinates) {
      results.set(job.jobKey, cachedCoordinates);
      continue;
    }
    const checkedAt = cached?.checkedAt ? new Date(cached.checkedAt).getTime() : 0;
    if (cached?.source === 'Verified full address / Census' && checkedAt && Date.now() - checkedAt < RETRY_FAILED_AFTER_MS) {
      results.set(job.jobKey, null);
      continue;
    }
    unresolved.push({ ...job, hash });
  }

  const censusResults = await Promise.all(unresolved.map(async (job) => ({
    ...job,
    coordinates: (await verifyDesktopAddress(job.address)).location,
  })));
  const newCacheEntries: Record<string, CachedGeocode> = {};
  for (const result of censusResults) {
    const coordinates = result.coordinates;
    const source = 'Verified full address / Census';
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

export type RoadMatrixElement = {
  originIndex?: number;
  destinationIndex?: number;
  distanceMeters?: number;
  duration?: string;
  condition?: string;
  status?: { code?: number; message?: string };
};

function durationMinutes(value: unknown): number | null {
  const match = String(value || "").match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds / 60)) : null;
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
  const roadMatrix = await osmTravelMatrix(
    locatedTrucks.map((entry) => entry.coordinates),
    locatedJobs.map((entry) => entry.coordinates),
  );
  const roadRoutes = new Map<string, { miles: number; travelMinutes: number }>();

  for (const element of roadMatrix || []) {
    const origin = locatedTrucks[Number(element.originIndex || 0)];
    const destination = locatedJobs[Number(element.destinationIndex || 0)];
    const minutes = durationMinutes(element.duration);
    const meters = Number(element.distanceMeters);
    const statusCode = Number(element.status?.code || 0);
    if (!origin || !destination || statusCode || element.condition !== "ROUTE_EXISTS" || !Number.isFinite(meters) || minutes == null) continue;
    roadRoutes.set(`${destination.job.jobKey}|${origin.truckName}`, {
      miles: Number((meters / 1609.344).toFixed(1)),
      travelMinutes: minutes,
    });
  }
  const hasRoadEstimates = roadRoutes.size > 0;

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
        const roadRoute = roadRoutes.get(`${job.jobKey}|${truckName}`);
        const miles = roadRoute?.miles ?? null;
        distances[job.jobKey][truckName] = {
          ...base,
          miles,
          travelMinutes: roadRoute?.travelMinutes ?? null,
          status: roadRoute ? "available" : "routing_unavailable",
          source: roadRoute ? "osm_road_estimate" : "estimated",
        };
      }
    }
  }

  return {
    date,
    fleetUpdatedAt: fleet?.lastUpdatedAt || null,
    routingProvider: hasRoadEstimates ? "osm_road_estimate" : "estimated",
    routingUpdatedAt: hasRoadEstimates ? new Date().toISOString() : null,
    distances,
  };
}
