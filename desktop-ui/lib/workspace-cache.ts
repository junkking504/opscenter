// Memory only: never persist operational records across a login or page reload.
type Entry = { value: unknown; receivedAt: number };
const entries = new Map<string, Entry>();
const maxEntries = 16;
const maxAgeMs = 5 * 60_000;
let generation = 0;

export function cachedWorkspace<T>(key: string): { value: T; receivedAt: number } | undefined {
  const entry = entries.get(key);
  if (!entry) return;
  if (Date.now() - entry.receivedAt > maxAgeMs) { entries.delete(key); return; }
  entries.delete(key); entries.set(key, entry);
  return entry as { value: T; receivedAt: number };
}

export function clearWorkspaceCache() { generation++; entries.clear(); }

/** Always performs a fresh authenticated read. Cache is only for immediate display. */
export async function fetchWorkspace<T>(url: string, signal: AbortSignal, key = url): Promise<T> {
  const started = generation;
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal });
  if (response.status === 401 || response.status === 403) clearWorkspaceCache();
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Workspace could not refresh.');
  signal.throwIfAborted();
  if (started === generation) {
    entries.delete(key);
    entries.set(key, { value: body, receivedAt: Date.now() });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
  }
  return body as T;
}

/** Invalidate related views before AND after writes, including uncertain outcomes. */
export function invalidatesWorkspaceCache(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  return url.origin === window.location.origin && url.pathname.startsWith('/api/')
    && url.pathname !== '/api/desktop/maintenance';
}
