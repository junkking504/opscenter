export type CloseoutPhotoEvidence = { appointmentId: string; urls: string[] };
export const CLOSEOUT_PHOTOS_REQUIRED = 'Upload at least one job photo before closing this job. Photos must be saved to this appointment in JunkWare.';

/** Call with URLs observed on the owning source page, never request-body evidence. */
export function closeoutPhotoEvidence(appointmentId: string, values: unknown): CloseoutPhotoEvidence {
  const urls = new Set<string>();
  if (/^\d{1,12}$/.test(appointmentId) && Array.isArray(values)) {
    for (const value of values) {
      if (typeof value !== 'string') continue;
      try {
        const url = new URL(value);
        if (url.origin !== 'https://junkware.junk-king.com' || url.username || url.password || url.hash
          || /%(?:2f|5c|2e)/i.test(url.pathname) || !url.pathname.startsWith('/system/aspnet/local/media/')
          || !/\.(?:jpe?g|png|webp)$/i.test(url.pathname)) continue;
        const name = decodeURIComponent(url.pathname.split('/').pop() || '');
        if (!name.includes(`-${appointmentId}-`)) continue;
        urls.add(url.origin + url.pathname);
      } catch { /* Unknown or malformed evidence cannot satisfy the requirement. */ }
    }
  }
  return { appointmentId, urls: [...urls].sort() };
}

export function closeoutPhotoCount(evidence: CloseoutPhotoEvidence | null | undefined, appointmentId: string): number {
  if (!evidence || evidence.appointmentId !== appointmentId) return 0;
  return closeoutPhotoEvidence(appointmentId, evidence.urls).urls.length;
}

export function requireCloseoutPhotos(source: Record<string, unknown>, targetStatus: string, appointmentId?: string): void {
  if (targetStatus !== '8') return;
  const evidence = source.photoEvidence as CloseoutPhotoEvidence | undefined;
  if (!closeoutPhotoCount(evidence, appointmentId ?? evidence?.appointmentId ?? '')) {
    throw new Error(CLOSEOUT_PHOTOS_REQUIRED);
  }
}
