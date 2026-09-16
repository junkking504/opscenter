import fs from 'node:fs';
import path from 'node:path';

const feeds = new Map<string, { watcher: fs.FSWatcher; listeners: Set<() => void> }>();

/** Publish only a local source-change hint; Schedule still validates receipts. */
export function subscribeWhatsAppPhotoUpdates(root: string, listener: () => void) {
  const directory = path.join(process.env.WHATSAPP_JOB_PHOTO_STATE_DIR || path.join(root, 'integrations', 'whatsapp-job-photos'), 'completed');
  let feed = feeds.get(directory);
  if (!feed) {
    const listeners = new Set<() => void>();
    const watcher = fs.watch(directory, (_event, filename) => {
      if (!/^[a-f0-9]{64}\.json$/.test(String(filename || ''))) return;
      for (const notify of listeners) notify();
    });
    const created = { watcher, listeners };
    watcher.on('error', () => {
      watcher.close();
      if (feeds.get(directory) === created) feeds.delete(directory);
    });
    feed = created;
    feeds.set(directory, feed);
  }
  feed.listeners.add(listener);
  const selected = feed;
  return () => {
    selected.listeners.delete(listener);
    if (!selected.listeners.size) {
      selected.watcher.close();
      if (feeds.get(directory) === selected) feeds.delete(directory);
    }
  };
}
