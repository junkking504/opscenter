import fs from 'node:fs';

type Entry<T> = { signature: string; storedAt: number; value: T };

function fileSignature(file: string): string {
  // Inode and ctime catch a same-size replacement that preserves mtime.
  try { const stat = fs.statSync(file); return `${file}=${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`; } catch { return `${file}=missing`; }
}

/**
 * Reuse a reading while every source file is unchanged and the reading is
 * younger than maxAgeMs. A single Command request reads the same GPS and
 * geocode files many times; parsing them once keeps requests fast while a
 * collector write (new inode, mtime, ctime or size) is picked up on the next call.
 * Callers must treat the returned value as read-only.
 */
export function sourceFileMemo<T>(maxAgeMs: number, maxEntries = 16) {
  const entries = new Map<string, Entry<T>>();
  return (key: string, files: string[], compute: () => T): T => {
    const signature = files.map(fileSignature).join('|');
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && hit.signature === signature && now >= hit.storedAt && now - hit.storedAt < maxAgeMs) return hit.value;
    const value = compute();
    entries.delete(key);
    entries.set(key, { signature, storedAt: now, value });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    return value;
  };
}
