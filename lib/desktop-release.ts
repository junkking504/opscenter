import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceBootstrap } from '../desktop-ui/lib/workspace-bootstrap';

export function desktopReferenceAllowed(runtime: string | undefined, enabled: string | undefined, requestUrl: string): boolean {
  const hostname = new URL(requestUrl).hostname;
  return runtime === 'MAC_MINI_PREVIEW' && enabled === 'reference'
    && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

export function desktopReleaseMode(runtime: string | undefined, enabled: string | undefined, requestUrl: string): 'reference' | 'command-live' {
  // Fixture data is never the default and can never be selected in production.
  return new URL(requestUrl).searchParams.get('data') === 'reference' && desktopReferenceAllowed(runtime, enabled, requestUrl)
    ? 'reference' : 'command-live';
}

type DesktopManifest = Record<string, { file: string; imports?: string[]; css?: string[] }>;
export function desktopWorkspacePreloads(manifest: DesktopManifest, workspace: string): string {
  const entry = ({ Fleet: 'live-fleet.tsx', Krewe: 'live-krewe.tsx', Marketing: 'live-marketing.tsx', Finance: 'live-finance.tsx' } as Record<string,string>)[workspace];
  const visited = new Set<string>();
  const assets = new Set<string>();
  const visit = (key: string) => {
    if (visited.has(key) || key === 'index.html') return;
    visited.add(key);
    const item = manifest[key]; if (!item) return;
    assets.add(item.file); item.css?.forEach(file => assets.add(file)); item.imports?.forEach(visit);
  };
  if (entry) visit(entry);
  return [...assets].filter(file => /^assets\/[A-Za-z0-9_-]+\.(js|css)$/.test(file)).map(file =>
    `<link rel="${file.endsWith('.css') ? 'stylesheet' : 'modulepreload'}" crossorigin href="/desktop-assets/${file}">`).join('');
}

export async function desktopReferenceDocument(mode: 'reference' | 'command-live' = 'reference', workspace?: WorkspaceBootstrap, initialWorkspace = 'Command'): Promise<string> {
  const template = await fs.readFile(path.join(process.cwd(), 'public', 'desktop-assets', 'index.html'), 'utf8');
  const placeholder = '__OPS_DESKTOP_BOOTSTRAP__';
  if (template.split(placeholder).length !== 2) throw new Error('Invalid desktop build bootstrap.');
  let preloads = '';
  if (mode === 'command-live') {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(process.cwd(), 'public', 'desktop-assets', '.vite', 'manifest.json'), 'utf8')) as DesktopManifest;
      preloads = desktopWorkspacePreloads(manifest, initialWorkspace);
    } catch { /* Older reference artifacts remain loadable without hints. */ }
  }
  return template.replace(placeholder, () => JSON.stringify({ mode, workspace }).replace(/</g, '\\u003c')).replace('</head>', () => `${preloads}</head>`);
}
