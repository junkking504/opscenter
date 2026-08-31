import crypto from "node:crypto";

export type PlanningLocation = {
  latitude: number;
  longitude: number;
};

const SERVICE_AREA_BOUNDS = {
  minimumLatitude: 29,
  maximumLatitude: 31.3,
  minimumLongitude: -93,
  maximumLongitude: -89.4,
} as const;

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

  // JunkWare may add the state from a separate field while the authoritative
  // geocode cache stores its address-only source value. These two forms are
  // the same service address, so match the Louisiana state variant explicitly.
  const withoutLouisianaState = normalized.replace(
    /, (?:LA|LOUISIANA) (?=\d{5}(?:-\d{4})?$)/,
    ", ",
  );
  return Array.from(new Set([normalized, withoutLouisianaState])).map(addressHash);
}

function canonicalAddress(address: string): string {
  return normalizeAddress(address)
    .replace(/(?:,|\s)+(?:LA|LOUISIANA) (?=\d{5}(?:-\d{4})?$)/, " ")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalStreetAddress(address: string): string {
  const canonical = canonicalAddress(address);
  // The fast schedule may include a business name before the service street
  // (for example, a storage facility name). A street address must begin at its
  // first street-number token, so use that stable portion for the final exact
  // comparison below.
  const streetStart = canonical.search(/\b\d{2,6}[A-Z]?\b/);
  return streetStart >= 0 ? canonical.slice(streetStart) : canonical;
}

function serviceAreaLocation(candidate: Record<string, unknown> | undefined): PlanningLocation | null {
  if (candidate?.match_confidence !== "confirmed") return null;
  // A unique geocoder result is not sufficient: Google and other providers
  // can return a plausible nearby building. Only render a locator after the
  // provider-returned house number and street name were matched to JunkWare.
  if (candidate.house_street_verified !== true) return null;
  const latitude = Number(candidate.latitude);
  const longitude = Number(candidate.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < SERVICE_AREA_BOUNDS.minimumLatitude || latitude > SERVICE_AREA_BOUNDS.maximumLatitude) return null;
  if (longitude < SERVICE_AREA_BOUNDS.minimumLongitude || longitude > SERVICE_AREA_BOUNDS.maximumLongitude) return null;
  return { latitude, longitude };
}

export function planningLocation(
  address: string,
  geocodes: Record<string, Record<string, unknown>>,
): PlanningLocation | null {
  if (!address || address === "—") return null;
  for (const hash of planningAddressHashes(address)) {
    const location = serviceAreaLocation(geocodes[hash]);
    if (location) return location;
  }

  // The fast schedule sometimes omits the comma between the street and city.
  // Use an exact punctuation/state-insensitive form only when it identifies one
  // confirmed point; otherwise retain the appointment without a locator.
  const target = canonicalStreetAddress(address);
  const locations = Object.values(geocodes)
    .filter((candidate) => canonicalStreetAddress(String(candidate.normalized_address || "")) === target)
    .map(serviceAreaLocation)
    .filter((location): location is PlanningLocation => location !== null);
  const uniqueLocations = Array.from(new Map(
    locations.map((location) => [`${location.latitude},${location.longitude}`, location]),
  ).values());
  return uniqueLocations.length === 1 ? uniqueLocations[0] : null;
}
