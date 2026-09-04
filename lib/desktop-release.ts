import fs from 'node:fs/promises';
import path from 'node:path';

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

export async function desktopReferenceDocument(mode: 'reference' | 'command-live' = 'reference'): Promise<string> {
  const template = await fs.readFile(path.join(process.cwd(), 'public', 'desktop-assets', 'index.html'), 'utf8');
  const placeholder = '__OPS_DESKTOP_BOOTSTRAP__';
  if (template.split(placeholder).length !== 2) throw new Error('Invalid desktop build bootstrap.');
  return template.replace(placeholder, JSON.stringify({ mode }));
}
