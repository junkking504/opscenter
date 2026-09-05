/** Fresh collection metadata cannot establish freshness of a missing record. */
export function sourceFreshness(timestamp: string | null | undefined, maxAgeSeconds: number, now = Date.now()) {
  const parsed = timestamp ? Date.parse(timestamp) : NaN;
  const ageSeconds = Number.isFinite(parsed) ? (now - parsed) / 1000 : null;
  const valid = ageSeconds !== null && ageSeconds >= -60;
  return { ageSeconds, fresh: valid && ageSeconds! <= maxAgeSeconds, valid, maxAgeSeconds };
}
export const CREW_PORTAL_MAX_AGE_SECONDS = 20 * 60;
