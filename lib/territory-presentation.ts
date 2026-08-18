const WESTBANK_LOCATION = /\b(?:algiers|gretna|harvey|marrero|terrytown|timberlane|woodmere|estelle|westwego|avondale|bridge\s+city|waggaman|belle\s+chasse|crown\s+point)\b/i;
const JEFFERSON_CORE_LOCATION = /\b(?:metairie|kenner)\b/i;
const LAFAYETTE = { latitude: 30.2241, longitude: -92.0198 };
const LAFAYETTE_SERVICE_RADIUS_MILES = 30;

/**
 * The Westbank is a visual area within the New Orleans market, not a reporting
 * territory. Keep the source territory unchanged while making its appointments
 * immediately recognizable on the dispatch map.
 */
export function isWestbankLocation(...locationValues: unknown[]): boolean {
  return WESTBANK_LOCATION.test(
    locationValues
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" "),
  );
}

export function isJeffersonCoreLocation(...locationValues: unknown[]): boolean {
  return JEFFERSON_CORE_LOCATION.test(
    locationValues
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" "),
  );
}

export function isWithinLafayetteServiceRadius(latitude: unknown, longitude: unknown): boolean {
  const pointLatitude = Number(latitude);
  const pointLongitude = Number(longitude);
  if (!Number.isFinite(pointLatitude) || !Number.isFinite(pointLongitude)) return false;

  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(pointLatitude - LAFAYETTE.latitude);
  const longitudeDelta = radians(pointLongitude - LAFAYETTE.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(LAFAYETTE.latitude)) * Math.cos(radians(pointLatitude)) * Math.sin(longitudeDelta / 2) ** 2;
  const distanceMiles = 3_958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distanceMiles <= LAFAYETTE_SERVICE_RADIUS_MILES;
}

export function appointmentTerritoryTone(territory: unknown, ...locationValues: unknown[]): string {
  if (isWestbankLocation(...locationValues)) return "is-westbank";
  if (isJeffersonCoreLocation(...locationValues)) return "is-jefferson";

  const normalized = String(territory || "").toLowerCase();
  if (normalized.includes("new orleans")) return "is-new-orleans";
  if (normalized.includes("jefferson")) return "is-jefferson";
  if (normalized.includes("northshore") || normalized.includes("north shore")) return "is-northshore";
  if (normalized.includes("baton rouge")) return "is-baton-rouge";
  if (normalized.includes("lafayette")) return "is-lafayette";
  return "is-unknown-territory";
}
