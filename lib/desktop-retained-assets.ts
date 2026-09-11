import fs from 'node:fs/promises';
import path from 'node:path';

/** Hashed public code only, from releases already retained by the controller. */
export async function readRetainedDesktopAsset(asset: string, cwd = process.cwd()): Promise<Buffer | null> {
  if (!/^[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(asset)) return null;
  const active = await fs.realpath(cwd);
  const releases = path.dirname(active);
  if (!['releases', 'preview-releases'].includes(path.basename(releases))) return null;
  const names = (await fs.readdir(releases, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^[a-f0-9]{40}$/.test(entry.name)).map(entry => entry.name);
  for (const name of names) {
    try {
      const file = path.join(releases, name, 'public', 'desktop-assets', 'assets', asset);
      // Release removal can race a read; try the next retained copy.
      return await fs.readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return null;
}
