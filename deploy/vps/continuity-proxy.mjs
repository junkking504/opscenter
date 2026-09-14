/** Mac-primary continuity gateway. Never replay a request after sending it. */
import http from 'node:http';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const READ_APIS = new Set([
  '/api/desktop/schedule', '/api/desktop/schedule/gps',
  '/api/desktop/schedule/calendar', '/api/desktop/schedule/history',
  '/api/desktop/schedule/routes', '/api/desktop/schedule/plan',
  '/api/desktop/command', '/api/desktop/fleet', '/api/desktop/krewe',
  '/api/desktop/krewe/hours', '/api/desktop/finance',
  '/api/desktop/estimates', '/api/desktop/photos', '/api/desktop/marketing',
  '/api/desktop/maintenance', '/api/health',
]);
const AUTH_APIS = new Set(['/api/auth/login', '/api/auth/logout']);
const READER_PARAMS = new Set(['date', 'view', 'employee', 'periodDate', 'page', 'truck', 'job', 'jobId', 'appointmentId', 'appointment', 'month', 'year', 'from', 'to', 'q']);
export function standbyRequest(method, rawUrl) {
  let url;
  try { url = new URL(rawUrl, 'http://127.0.0.1'); } catch { return null; }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return null; }
  if (pathname.includes('\\') || pathname.includes('%') || pathname.includes('//')) return null;
  if (AUTH_APIS.has(pathname) && method === 'POST') return url.pathname + url.search;
  if (!['GET', 'HEAD'].includes(method)) return null;
  if (pathname.startsWith('/api/')) {
    if (!READ_APIS.has(pathname)) return null;
    if (['verify','receipt','receiptId','requestId','action','run','retry'].some(key=>url.searchParams.has(key))) return null;
    // Several GET endpoints can request collection or verify/retry writes.
    for (const key of [...url.searchParams.keys()]) if (!READER_PARAMS.has(key)) url.searchParams.delete(key);
    return url.pathname + url.search;
  }
  if (pathname === '/' || pathname === '/desktop' || pathname === '/login' || pathname === '/unauthorized'
      || pathname.startsWith('/_next/static/') || pathname.startsWith('/desktop-assets/')
      || pathname === '/favicon.ico') return url.pathname + url.search;
  return null;
}
function json(res, status, value) {
  res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'});
  res.end(JSON.stringify(value));
}
function probe(origin, path, timeout, recovery = false) {
  return new Promise(resolve => {
    const request = http.get(new URL(path, origin), {headers: {'connection': 'close'}}, response => {
      if (!recovery) {response.resume(); resolve(response.statusCode >= 200 && response.statusCode < 400); return;}
      let body='';
      response.on('data', chunk => {body+=chunk; if(body.length>256*1024) request.destroy();});
      response.on('error',()=>resolve(false));
      response.on('end',()=>{
        try {const health=JSON.parse(body);resolve(health.runtime==='VPS'
          && health.platformKernel?.healthy===true
          && health.platformKernel?.databaseName==='opscenter_recovery_20260914'
          && health.assignmentStoreWritable===false && health.operatorStateWritable===false);}
        catch {resolve(false);}
      });
    });
    request.setTimeout(timeout, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}
const banner = `<div id="ops-continuity-notice" role="status" style="position:fixed;inset:0 0 auto;z-index:2147483647;background:#ffdd57;color:#171717;padding:10px 16px;font:600 14px/1.4 system-ui;text-align:center">Recovery view — Mission Control is unavailable. Showing the last synchronized records. Changes and source refreshes are paused. Reload after Mission Control recovers.</div><style>html{padding-top:60px!important}</style>`;

export function createContinuityProxy(options = {}) {
  const primary = options.primary || 'http://127.0.0.1:3000';
  const standby = options.standby || 'http://127.0.0.1:3001';
  const timeout = options.timeout || 2500;
  const snapshotFile = options.snapshotFile;
  let currentCheck, currentStandbyCheck;
  function standbyCheck() {
    return currentStandbyCheck ||= probe(standby, '/api/health', options.recoveryTimeout ?? 10000, true)
      .finally(() => {currentStandbyCheck = null;});
  }
  let lastCheck = 0;
  let state = {primary: false, standby: false, checkedAt: null};
  async function check() {
    if (currentCheck) return currentCheck;
    if (Date.now() - lastCheck < (options.probeCacheMs ?? 2000)) return state;
    const recovery = standbyCheck();
    currentCheck = probe(primary, '/login', timeout).then(async primaryReady => {
      // Cold source reads can delay standby health. Never make a healthy primary
      // wait for that independent check; recovery still requires a current result.
      const standbyReady = primaryReady ? state.standby : await recovery;
      lastCheck = Date.now();
      const next = {primary: primaryReady, standby: standbyReady, checkedAt: new Date().toISOString()};
      state = next;
      if (primaryReady) void recovery.then(ready => {if (state === next) state.standby = ready;});
      return state;
    }).finally(() => {currentCheck = null;});
    return currentCheck;
  }
  const server = http.createServer(async (req, res) => {
    const targetState = await check();
    if (req.url === '/api/continuity/status' && ['GET','HEAD'].includes(req.method)) {
      let snapshot = null;
      try { snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8')); } catch { /* Unknown stays unknown. */ }
      return json(res, 200, {mode: targetState.primary ? 'primary' : targetState.standby ? 'read-only-recovery' : 'unavailable', checkedAt: targetState.checkedAt, primaryReachable: targetState.primary, standbyReady: targetState.standby, snapshotAt: snapshot?.snapshotAt || null});
    }
    const recovering = !targetState.primary;
    if (recovering && !targetState.standby) return json(res, 503, {error: 'OpsCenter is unavailable. No operation was submitted by this gateway.'});
    const targetPath = recovering ? standbyRequest(req.method, req.url) : req.url;
    if (targetPath === null) return json(res, 503, {code: 'standby_read_only', error: 'Mission Control is unavailable. Recovery is view-only; this action was not submitted. Source refreshes and changes resume on the primary.'});
    const target = new URL(recovering ? standby : primary);
    const headers = {...req.headers};
    delete headers.connection; delete headers['proxy-connection'];
    // Transform only uncompressed recovery HTML. Preserve host and auth headers.
    if (recovering) headers['accept-encoding'] = 'identity';
    const upstream = http.request({hostname: target.hostname, port: target.port, method: req.method, path: targetPath, headers}, response => {
      const responseHeaders = {...response.headers, 'x-opscenter-continuity': recovering ? 'read-only-recovery' : 'primary'};
      if (recovering) responseHeaders['cache-control'] = 'private, no-store';
      if (recovering && req.method === 'GET' && String(response.headers['content-type']).includes('text/html') && response.statusCode === 200) {
        const chunks = []; let bytes = 0;
        response.on('data', chunk => { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) response.destroy(new Error('Recovery page exceeded limit')); else chunks.push(chunk); });
        response.on('end', () => {
          const html = Buffer.concat(chunks).toString('utf8').replace(/(<body[^>]*>)/i, '$1' + banner);
          delete responseHeaders['content-length']; delete responseHeaders['content-encoding']; delete responseHeaders.etag;
          res.writeHead(response.statusCode, responseHeaders); res.end(html);
        });
        response.on('error', () => { if (!res.headersSent) json(res, 502, {error:'Recovery page could not be loaded.'}); else res.destroy(); });
      } else { res.writeHead(response.statusCode, responseHeaders); response.pipe(res); response.on('error', () => res.destroy()); }
    });
    upstream.setTimeout(options.requestTimeout || 180000, () => upstream.destroy(new Error('Origin timeout')));
    upstream.on('error', () => {
      lastCheck = 0;
      // A reset can occur after an operation commits. Never retry on either origin.
      if (!res.headersSent) json(res, 502, {code: 'origin_response_unknown', error: 'The origin response was interrupted. If you submitted a change, check its saved result before retrying.'});
      else res.destroy();
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
    req.pipe(upstream);
  });
  server.on('connect', (_req, socket) => socket.destroy());
  server.on('upgrade', (_req, socket) => socket.destroy());
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createContinuityProxy({primary: process.env.CONTINUITY_PRIMARY, standby: process.env.CONTINUITY_STANDBY, snapshotFile: process.env.CONTINUITY_SNAPSHOT_FILE});
  server.listen(Number(process.env.CONTINUITY_PORT || 3002), '127.0.0.1', () => console.log('Continuity gateway listening on loopback; automatic recovery is read-only.'));
}
