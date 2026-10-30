/** Browser-scoped Maps token, never a Maps Server API key or signing key. */
export function appleMapsConfig(env: Record<string, string | undefined> = process.env) {
  const token = env.OPSCENTER_APPLE_MAPS_TOKEN?.trim();
  return env.OPSCENTER_APPLE_MAPS_ENABLED === '1' && token
    ? { provider: 'apple' as const, token }
    : { provider: 'openstreetmap' as const };
}
