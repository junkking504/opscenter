/** Shared, bounded navigation identities. These never authorize access to records. */
export function alertTruck(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = String(value).trim().match(/^(?:Truck\s*#?\s*|#\s*)?(\d{1,3})$/i);
  return match && Number(match[1]) > 0 ? `Truck ${Number(match[1])}` : null;
}
export function alertDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function truckMapHref(truck: string, date: string): string {
  return '/desktop?' + new URLSearchParams({workspace:'Schedule', scheduleView:'board', date, truck, focus:'truck'});
}
/** Deliberately narrow native-notification routes; reject unknown parameters and external URLs. */
export function notificationDestination(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 700 || /[\u0000-\u0020\u007f\\]/.test(value)) return undefined;
  const job = value.match(/^\/jobs\?date=(\d{4}-\d{2}-\d{2})#job-jk[0-9]{1,12}$/);
  if (job) return alertDate(job[1]) ? value : undefined;
  if (!value.startsWith('/desktop?')) return undefined;
  const url = new URL(value, 'https://ops.junk-king.app');
  const p=url.searchParams, keys=[...p.keys()];
  if ([...p.values()].some(v=>/[\u0000-\u001f\u007f]/.test(v))) return undefined;
  if (new Set(keys).size !== keys.length || url.hash || !alertDate(p.get('date') || '')) return undefined;
  if (p.get('workspace') === 'Schedule' && p.get('scheduleView') === 'board' && p.get('focus') === 'truck'
    && keys.length === 5 && keys.every(k=>['workspace','scheduleView','date','truck','focus'].includes(k)) && alertTruck(p.get('truck'))) return truckMapHref(alertTruck(p.get('truck'))!,p.get('date')!);
  if (p.get('workspace') === 'Krewe' && p.get('kreweView') === 'today' && p.get('focus') === 'record'
    && keys.every(k=>['workspace','kreweView','date','member','focus'].includes(k)) && keys.length >= 4
    && (!p.has('member') || !!p.get('member')?.trim() && p.get('member')!.length <= 200)) return url.pathname+url.search;
  return undefined;
}
