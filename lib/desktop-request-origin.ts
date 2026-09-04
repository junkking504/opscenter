import { resolveRequestOrigin } from '@/lib/auth';
/** Uses the same trusted reverse-proxy host/protocol boundary as session cookies and redirects. */
export function isDesktopWriteOriginAllowed(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  // Existing authenticated internal handlers do not send an Origin header.
  return !origin || origin === resolveRequestOrigin(request);
}
