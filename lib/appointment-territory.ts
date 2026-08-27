const DENHAM_SPRINGS = /\bdenham\s+springs\b/i;
// JunkWare can label a Westbank appointment as Jefferson Parish or New
// Orleans. Classify the South Bank service localities from the service address
// before retaining that broad source territory. The ZIPs cover addresses where
// the city is omitted, while deliberately leaving Chalmette and New Orleans
// East out of this override.
const WESTBANK_LOCATION = /\b(?:algiers|avondale|barataria|belle\s+chasse|bridge\s+city|crown\s+point|estelle|gretna|harvey|jean\s+lafitte|lafitte|marrero|terrytown|timberlane|waggaman|westwego|woodmere)\b|\b(?:70037|70053|70056|70058|70072|70094|70114|70131)(?:-\d{4})?\b/i;

/**
 * Apply location-specific territory rules that must override the territory
 * supplied by JunkWare or the normalized collector feed.
 */
export function appointmentTerritoryForLocation(
  territory: unknown,
  ...locationValues: unknown[]
): string {
  const location = locationValues
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");

  if (DENHAM_SPRINGS.test(location)) return "Baton Rouge";
  if (WESTBANK_LOCATION.test(location)) return "Westbank";

  return String(territory || "").trim() || "Unknown territory";
}
