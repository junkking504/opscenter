import {cookies} from 'next/headers';
import path from 'node:path';
import {AUTH_SESSION_COOKIE, verifyAuthSessionCookie} from '@/lib/auth';
import {subscribeLinxupUpdates} from '@/lib/linxup-update-stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return Response.json({error:'Authentication required.'}, {status:401});
  const root = process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), 'data');
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const close = () => {
        if (closed) return;
        closed = true; unsubscribe(); clearInterval(heartbeat);
        request.signal.removeEventListener('abort', close);
        try { controller.close(); } catch { /* Already canceled by the client. */ }
      };
      cleanup = close;
      const send = (value: string) => { if (!closed) { try { controller.enqueue(encoder.encode(value)); } catch { close(); } } };
      try { unsubscribe = subscribeLinxupUpdates(root, () => send('event: change\ndata: {}\n\n')); }
      catch { close(); return; }
      request.signal.addEventListener('abort', close, {once:true});
      if (request.signal.aborted) { close(); return; }
      send(': connected\n\n');
      heartbeat = setInterval(() => send(': keepalive\n\n'), 20_000);
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {headers:{'Content-Type':'text/event-stream','Cache-Control':'private, no-cache, no-transform','X-Accel-Buffering':'no'}});
}
