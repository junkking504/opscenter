/** Keep internal source links in the current workspace shell. */
export function desktopSourceHref(href: string, origin: string): string {
  const url = new URL(href, origin);
  if (url.origin !== new URL(origin).origin) return url.href;
  const workspace = ({ '/jobs': 'Schedule', '/crew': 'Krewe', '/fleet': 'Fleet', '/finance': 'Finance', '/marketing': 'Marketing', '/inbox': 'Command', '/': 'Command' } as Record<string, string>)[url.pathname];
  if (!workspace) return url.pathname + url.search + url.hash;
  if (workspace === 'Schedule') {
    if (!url.searchParams.has('q') && url.searchParams.has('jk')) url.searchParams.set('q', url.searchParams.get('jk')!);
    url.searchParams.set('scheduleView', 'board');
  }
  url.pathname = '/desktop'; url.searchParams.set('workspace', workspace); url.searchParams.set('data', 'live');
  return url.pathname + url.search + url.hash;
}
export function desktopAppointmentHref(reference: string, date: string): string {
  return '/desktop?' + new URLSearchParams({workspace:'Schedule',scheduleView:'board',scheduleDay:'today',date,q:reference});
}
