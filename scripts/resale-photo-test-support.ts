import fs from 'node:fs';
import ts from 'typescript';
import * as photos from '../lib/resale-photos';
import * as items from '../lib/resale-items';
import * as finance from '../lib/desktop-finance';
import * as commercial from '../lib/desktop-marketing';
import { opsRoleCan } from '../lib/ops-roles';
import { isDesktopWriteOriginAllowed } from '../lib/desktop-request-origin';

/** Real route/storage behavior with synthetic session identity only. */
export function resaleTestRoutes() {
  const session = { signedIn: true, role: 'manager' };
  const dependencies: Record<string, unknown> = {
    'node:fs': fs,
    'next/server': { NextResponse: Response },
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'fixture' }) }) },
    '@/lib/auth': { AUTH_SESSION_COOKIE: 'fixture', verifyAuthSessionCookie: async () => session.signedIn ? { email: 'fixture-manager', role: session.role } : null },
    '@/lib/ops-roles': { opsRoleCan }, '@/lib/desktop-request-origin': { isDesktopWriteOriginAllowed },
    '@/lib/resale-photos': photos, '@/lib/resale-items': items,
    '@/lib/desktop-finance': finance, '@/lib/desktop-marketing': commercial,
    '@/lib/report-dates': { chicagoDateKey: () => '2026-10-05' },
  };
  function compile(file: string) {
    const output = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const handlers: Record<string, (request: Request, context?: { params: Promise<{ photoId: string }> }) => Promise<Response>> = {};
    new Function('require', 'exports', output)((name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`); return dependencies[name]; }, handlers);
    return handlers;
  }
  return { session, legacy: compile('../app/api/resale-items/route.ts'), upload: compile('../app/api/resale-items/photos/route.ts'), view: compile('../app/api/resale-items/photos/[photoId]/route.ts'), finance: compile('../app/api/desktop/finance/route.ts') };
}
