import { CREW_JOBS_ORIGIN, CREW_JOBS_KINGPIN_ORIGIN, CREW_JOBS_LEGACY_ORIGIN } from './crew-phone';

// Keep standalone inspection origins on their existing cookies and draft storage.
export function usesWaypointInspection(headers: Pick<Headers, 'get'>): boolean {
  const hostname = (headers.get('x-forwarded-host') || headers.get('host') || '').split(':')[0].toLowerCase();
  return [CREW_JOBS_ORIGIN, CREW_JOBS_KINGPIN_ORIGIN, CREW_JOBS_LEGACY_ORIGIN]
    .some(origin => new URL(origin).hostname === hostname);
}
