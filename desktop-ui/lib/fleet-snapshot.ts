/** These tabs share the same authoritative daily records; reports have extra sources. */
export function fleetSnapshotUrl(date: string, view: string): string {
  const sourceView = view === 'scores' || view === 'reports' ? view : 'overview';
  return `/api/desktop/fleet?date=${encodeURIComponent(date)}&view=${sourceView}`;
}
