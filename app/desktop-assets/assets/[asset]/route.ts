import { readRetainedDesktopAsset } from '@/lib/desktop-retained-assets';

// Current public files take precedence. Missing old chunks can still be read
// from the controller's retained releases without changing release retention.
export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  const body = await readRetainedDesktopAsset(asset);
  if (!body) return new Response('Desktop asset unavailable', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(new Uint8Array(body), { headers: {
    'Content-Type': asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  } });
}
