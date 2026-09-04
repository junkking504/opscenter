export function navigationValue<T extends string>(search: string, key: string, allowed: readonly T[], fallback: T): T {
  const value = new URLSearchParams(search).get(key);
  return allowed.includes(value as T) ? value as T : fallback;
}
export function workspaceUrl(href: string, state: Record<string, string>) {
  const url = new URL(href);
  for (const [key, value] of Object.entries(state)) url.searchParams.set(key, value);
  return url;
}
