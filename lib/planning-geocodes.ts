import crypto from "node:crypto";

export type PlanningLocation = {
  latitude: number;
  longitude: number;
};

function normalizeAddress(address: string): string {
  return String(address || "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim()
    .toUpperCase();
}

function addressHash(address: string): string {
  return crypto.createHash("sha256").update(address).digest("hex");
}

function planningAddressHashes(address: string): string[] {
  const normalized = normalizeAddress(address);
  if (!normalized) return [];

  // JunkWare sometimes supplies the state as a separate column while the
  // confirmed geocode was saved from its address-only form. Both strings name
  // the same service address; support the two canonical Louisiana formats
  // without falling back to unverified coordinates.
  const withoutLouisianaState = normalized.replace(
    /, (?:LA|LOUISIANA) (?=\d{5}(?:-\d{4})?$)/,
    ", ",
  );
  return Array.from(new Set([normalized, withoutLouisianaState])).map(addressHash);
}

export function planningLocation(
  address: string,
  geocodes: Record<string, Record<string, unknown>>,
): PlanningLocation | null {
  if (!address || address === "—") return null;
  const match = planningAddressHashes(address)
    .map((hash) => geocodes[hash])
    .find((candidate) => candidate?.latitude != null && candidate?.longitude != null);
  // Number(null) is 0, which Leaflet renders off the Louisiana map at 0,0.
  // Only use an address after the confirmed geocoder supplied both values.
  if (!match) return null;
  const latitude = Number(match.latitude);
  const longitude = Number(match.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude === 0 || longitude === 0) return null;
  return { latitude, longitude };
}
