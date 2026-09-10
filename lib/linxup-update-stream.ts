import fs from 'node:fs';
import path from 'node:path';

const feeds = new Map<string, {watcher: fs.FSWatcher; listeners: Set<() => void>}>();

/** One filesystem watcher shared by connected screens; no polling or debounce. */
export function subscribeLinxupUpdates(root: string, listener: () => void) {
  let feed = feeds.get(root);
  if (!feed) {
    const listeners = new Set<() => void>();
    const watcher = fs.watch(path.join(root, 'history', 'linxup'), {recursive:true}, (_event, filename) => {
      const name = String(filename || '').replaceAll('\\', '/');
      if (!/^(?:linxup_location_\d{4}-\d{2}-\d{2}\.json|appointment_visits\/linxup_appointment_visits_\d{4}-\d{2}-\d{2}\.json|geofence_positions\/\d{4}-\d{2}-\d{2}\.json|alerts\/linxup_alerts_\d{4}-\d{2}-\d{2}\.json)$/.test(name)) return;
      for (const notify of listeners) notify();
    });
    // Existing browser polling remains the fallback if the watched source fails.
    watcher.on('error', () => { watcher.close(); feeds.delete(root); });
    feed = {watcher, listeners}; feeds.set(root, feed);
  }
  feed.listeners.add(listener);
  const selected = feed;
  return () => {
    selected.listeners.delete(listener);
    if (!selected.listeners.size) {
      selected.watcher.close();
      if (feeds.get(root) === selected) feeds.delete(root);
    }
  };
}
