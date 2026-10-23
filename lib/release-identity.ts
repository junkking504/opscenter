import fs from 'node:fs';
import path from 'node:path';
import { releaseBackground } from './release-background';

let servedSha: string | null | undefined;
export function releaseIdentity() {
  if (servedSha === undefined) {
    try {
      const file = path.join(process.cwd(), '.opscenter-release');
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('Invalid release identity');
      const matches = [...fs.readFileSync(file, 'utf8').matchAll(/^commit=([a-f0-9]{40})$/gm)];
      servedSha = matches.length === 1 ? matches[0][1] : null;
    } catch { servedSha = null; }
  }
  return { sha: servedSha, ...releaseBackground() };
}
