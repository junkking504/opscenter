export const currentOperatingDay = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);

export function isOperatingDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shiftOperatingDay(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const operatingDayLabel = (date: string) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
}).format(new Date(`${date}T12:00:00Z`));

// Old Schedule links stored a base date plus a local tomorrow offset. Resolve
// that once, before any workspace loads data, then keep a single absolute date.
export function normalizeOperatingDayUrl(href: string, today = currentOperatingDay()): URL {
  const url = new URL(href);
  const requested = url.searchParams.get('date');
  const base = requested && isOperatingDay(requested) ? requested : today;
  if (url.searchParams.get('workspace') === 'Schedule' && url.searchParams.get('scheduleDay') === 'tomorrow') {
    url.searchParams.set('date', shiftOperatingDay(base, 1));
  } else if (requested && !isOperatingDay(requested)) {
    url.searchParams.delete('date');
  }
  url.searchParams.set('scheduleDay', 'today');
  return url;
}

export function operatingDayUrl(href: string, date: string, workspace?: string): URL {
  const url = new URL(href);
  url.searchParams.set('date', date);
  url.searchParams.set('scheduleDay', 'today');
  // Appointment selection belongs to the old day, not the newly selected day.
  url.searchParams.delete('q');
  url.searchParams.delete('appointment');
  if (workspace) url.searchParams.set('workspace', workspace);
  if (workspace === 'Schedule') url.searchParams.set('scheduleView', 'board');
  return url;
}
