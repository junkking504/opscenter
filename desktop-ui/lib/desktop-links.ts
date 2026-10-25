import { alertTruck, truckMapHref } from '../../lib/alert-destination';
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

export function desktopCustomerHref(appointmentId?: string, date?: string): string {
  const params = new URLSearchParams({ data: 'live', workspace: 'Schedule', scheduleView: 'customers' });
  if (appointmentId && /^\d{1,12}$/.test(appointmentId)) params.set('customer', appointmentId);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) params.set('date', date);
  return '/desktop?' + params;
}

/** Use the uniquely linked source appointment; otherwise preserve the source reference. */
function sourceAlertHref(alert: DesktopAlert, snapshot: Pick<DesktopCommandSnapshot, 'date' | 'crewProgress'>, origin: string): string {
  const jobs = snapshot.crewProgress?.jobs.filter(job => job.updateIds.includes(alert.id)) || [];
  const linked=()=>jobs.length===1 ? desktopSourceHref(jobs[0].href,origin) : '';
  if(!alert.href?.trim())return linked();
  let raw:URL;try{raw=new URL(alert.href,origin);}catch{return linked();}
  if(!['http:','https:'].includes(raw.protocol))return linked();
  const sourceHref = desktopSourceHref(alert.href, origin);
  const url = new URL(sourceHref, origin);
  if (url.origin === new URL(origin).origin && url.pathname === '/desktop' && url.searchParams.get('workspace') === 'Schedule' && url.searchParams.has('appointment')) {
    if (!url.searchParams.has('date')) url.searchParams.set('date', snapshot.date);
    url.searchParams.set('scheduleView', 'board');
    url.searchParams.set('scheduleDay', 'today');
    return url.pathname + url.search + url.hash;
  }
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

/** Route known identities first, preserving valid source links when no finer identity exists. */
export function desktopAlertHref(alert: DesktopAlert, snapshot: Pick<DesktopCommandSnapshot, 'date' | 'crewProgress'>, origin: string): string {
  const source = sourceAlertHref(alert, snapshot, origin);
  const url = new URL(source || '/desktop', origin);
  if (url.origin !== new URL(origin).origin) return source;
  const p = url.searchParams;
  const date = p.get('date') || snapshot.date;
  const truck = alertTruck(alert.truck) || alertTruck(p.get('truck')) || alertTruck(alert.title.match(/^Truck\s*#?\s*\d+\b/i)?.[0]);
  if (alert.label === 'Geofence' && truck) return truckMapHref(truck, date);
  const workspace = p.get('workspace');
  if (workspace === 'Schedule' && (p.has('appointment') || p.has('q'))) {
    p.set('focus','record');
  } else if (workspace === 'Krewe' || alert.domain === 'Krewe') {
    url.pathname='/desktop'; p.set('workspace','Krewe'); p.set('kreweView','today');
    const member=alert.facts.find(f=>/^(Krewe member|Crew member|Employee)$/i.test(f.label))?.value;
    if (member && member.length <= 200) p.set('member',member);
    p.set('focus','record');
  } else if (workspace === 'Fleet' && truck) {
    p.set('truck',truck); p.set('focus','record');
  } else if (alert.label === 'Schedule Summary') {
    url.pathname='/desktop'; p.set('workspace','Schedule'); p.set('scheduleView','board'); p.set('focus','record');
  } else if (!source) {
    return '/desktop?' + new URLSearchParams({workspace:'Command',commandView:'now',date,alert:alert.id,focus:'alert'});
  }
  p.set('date',date);
  return url.pathname+url.search+url.hash;
}
