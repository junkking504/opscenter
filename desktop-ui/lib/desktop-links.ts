import type { DesktopAlert, DesktopCommandSnapshot } from './live-contract';

/** Keep internal source links in the current workspace shell. */
export function desktopSourceHref(href: string, origin: string): string {
  const url = new URL(href, origin);
  if (url.origin !== new URL(origin).origin) return url.href;
  const workspace = ({ '/jobs': 'Schedule', '/crew': 'Krewe', '/fleet': 'Fleet', '/finance': 'Finance', '/marketing': 'Marketing', '/inbox': 'Command', '/': 'Command' } as Record<string, string>)[url.pathname];
  if (!workspace) return url.pathname + url.search + url.hash;
  if (workspace === 'Schedule') {
    const reference = url.searchParams.get('jk') || url.hash.match(/^#job-(JK\d+)$/i)?.[1]?.toUpperCase();
    if (!url.searchParams.has('q') && !url.searchParams.has('appointment') && reference) url.searchParams.set('q', reference);
    url.searchParams.set('scheduleView', 'board');
    url.searchParams.set('scheduleDay', 'today');
    if (reference) url.hash = '';
  }
  url.pathname = '/desktop'; url.searchParams.set('workspace', workspace); url.searchParams.set('data', 'live');
  return url.pathname + url.search + url.hash;
}
export function desktopAppointmentHref(reference: string, date: string, appointmentId?: string): string {
  const params = new URLSearchParams({data:'live',workspace:'Schedule',scheduleView:'board',scheduleDay:'today',date});
  if (appointmentId && /^\d{1,12}$/.test(appointmentId)) params.set('appointment', appointmentId);
  else params.set('q', reference);
  return '/desktop?' + params;
}

/** Use the uniquely linked source appointment; otherwise preserve the source reference. */
export function desktopAlertHref(alert: DesktopAlert, snapshot: Pick<DesktopCommandSnapshot, 'date' | 'crewProgress'>, origin: string): string {
  const sourceHref = desktopSourceHref(alert.href, origin);
  const url = new URL(sourceHref, origin);
  if (url.origin === new URL(origin).origin && url.pathname === '/desktop' && url.searchParams.get('workspace') === 'Schedule' && url.searchParams.has('appointment')) {
    if (!url.searchParams.has('date')) url.searchParams.set('date', snapshot.date);
    url.searchParams.set('scheduleView', 'board');
    url.searchParams.set('scheduleDay', 'today');
    return url.pathname + url.search + url.hash;
  }
  const jobs = snapshot.crewProgress?.jobs.filter(job => job.updateIds.includes(alert.id)) || [];
  if (jobs.length === 1) return desktopSourceHref(jobs[0].href, origin);
  if (url.origin === new URL(origin).origin && url.pathname === '/desktop' && url.searchParams.get('workspace') === 'Schedule') {
    if (!url.searchParams.has('date')) url.searchParams.set('date', snapshot.date);
    if (!url.searchParams.has('appointment') && !url.searchParams.has('q')) {
      const reference = alert.title.match(/\bJK\d+\b/i)?.[0]?.toUpperCase();
      if (reference) url.searchParams.set('q', reference);
    }
    url.searchParams.set('scheduleView', 'board');
    url.searchParams.set('scheduleDay', 'today');
  }
  return url.origin === new URL(origin).origin ? url.pathname + url.search + url.hash : url.href;
}
