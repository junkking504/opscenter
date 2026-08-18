const DENHAM_SPRINGS = /\bdenham\s+springs\b/i;

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

  return String(territory || "").trim() || "Unknown territory";
}
