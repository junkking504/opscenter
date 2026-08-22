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

function planningAddressIdentity(address: string): string {
  return normalizeAddress(address)
    .replace(/(?:,|\s)(?:LA|LOUISIANA) (?=\d{5}(?:-\d{4})?$)/, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function confirmedCoordinates(candidate: Record<string, unknown> | undefined): PlanningLocation | null {
  if (candidate?.match_confidence !== "confirmed") return null;
  const latitude = Number(candidate.latitude);
  const longitude = Number(candidate.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude === 0 || longitude === 0) return null;
  return { latitude, longitude };
}

export function planningLocation(
  address: string,
  geocodes: Record<string, Record<string, unknown>>,
): PlanningLocation | null {
  if (!address || address === "—") return null;
  const directMatch = planningAddressHashes(address)
    .map((hash) => geocodes[hash])
    .map(confirmedCoordinates)
    .find(Boolean);
  if (directMatch) return directMatch;

  const identity = planningAddressIdentity(address);
  const compatibleMatch = Object.values(geocodes)
    .filter((candidate) => planningAddressIdentity(String(candidate.normalized_address || "")) === identity)
    .map(confirmedCoordinates)
    .find(Boolean);
  // Number(null) is 0, which Leaflet renders off the Louisiana map at 0,0.
  // Only use an address after the confirmed geocoder supplied both values.
  return compatibleMatch || null;
}
