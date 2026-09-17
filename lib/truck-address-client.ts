export type TruckAddressResult = { address: string; stale: boolean };
const cache = new Map<string, TruckAddressResult>();

/** Only the selected position retries. Unmount/movement cancels both the timer
 * and request; the server remains the shared provider rate-limit authority. */
export function watchTruckAddress(latitude: number, longitude: number, update: (result: TruckAddressResult) => void) {
  const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const saved = cache.get(key);
  if (saved) update(saved);
  async function lookup() {
    let delay = 60_000;
    try {
      const response = await fetch('/api/fleet-location-address', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({latitude, longitude}), signal: controller.signal,
      });
      if (response.status === 401 || response.status === 400) return;
      const payload = response.ok ? await response.json() : null;
      if (controller.signal.aborted) return;
      const address = typeof payload?.address === 'string' ? payload.address.trim() : '';
      if (address) {
        const result = {address, stale:Boolean(payload?.stale)};
        cache.delete(key); cache.set(key, result);
        while (cache.size > 256) cache.delete(cache.keys().next().value!);
        update(result);
        if (!payload.retryAfterMs && !result.stale) return;
      }
      if (typeof payload?.retryAfterMs === 'number' && Number.isFinite(payload.retryAfterMs)) delay = Math.max(1000, payload.retryAfterMs);
    } catch { /* Preserve the last address; a transient failure is retryable. */ }
    if (!controller.signal.aborted) timer = setTimeout(() => void lookup(), delay);
  }
  void lookup();
  return () => { controller.abort(); clearTimeout(timer); };
}
