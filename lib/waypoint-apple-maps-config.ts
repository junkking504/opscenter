/** Waypoint runs on its own website, so it needs its own browser-scoped MapKit token
 * (restricted to that website in Apple's portal) and its own switch. Never a Server API key.
 * Off by default: Waypoint keeps its current OpenStreetMap map. */
export function waypointAppleMapsConfig(env: Record<string, string | undefined> = process.env) {
  const token = env.OPSCENTER_WAYPOINT_APPLE_MAPS_TOKEN?.trim();
  return env.OPSCENTER_WAYPOINT_APPLE_MAPS_ENABLED === '1' && token
    ? { provider: 'apple' as const, token }
    : { provider: 'openstreetmap' as const };
}

export function waypointAppleMapsEnabled(env: Record<string, string | undefined> = process.env) {
  return waypointAppleMapsConfig(env).provider === 'apple';
}
