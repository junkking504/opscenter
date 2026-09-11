import { maintenanceOperation, validReadSnapshot, type ClientEvidence } from './maintenance-evidence';
// Fixed operation/method/status only. Never transmit URLs, IDs, bodies or stacks.
export function installMaintenanceTelemetry() {
  const original = window.fetch.bind(window);
  const sent: Record<string, number> = {};
  const report = (evidence: ClientEvidence) => {
    const now = Date.now(); if (now - (sent[evidence.category] || 0) < 60_000) return;
    sent[evidence.category] = now;
    void original('/api/desktop/maintenance', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(evidence), signal: AbortSignal.timeout(5000) }).catch(() => {});
  };
  window.addEventListener('error', () => report({ category: 'javascript', failure: 'runtime' }));
  window.addEventListener('unhandledrejection', event => { if (event.reason?.name !== 'AbortError') report({ category: 'javascript', failure: 'runtime' }); });
  window.fetch = async (input, init) => {
    let operation: ReturnType<typeof maintenanceOperation> = null;
    let pathname = '';
    try { const url = new URL(input instanceof Request ? input.url : String(input), window.location.href); if (url.origin === window.location.origin) { pathname = url.pathname; operation = maintenanceOperation(pathname); } } catch { /* preserve original validation */ }
    const rawMethod = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const method = (['GET','POST','PUT','PATCH','DELETE'].includes(rawMethod) ? rawMethod : 'GET') as ClientEvidence['method'];
    try {
      const response = await original(input, init);
      if (operation) {
        if (response.status >= 500 || [401,403].includes(response.status)) report({ category: operation, method, failure: 'http', status: response.status });
        // Validate only exact top-level read contracts, not detail/receipt endpoints.
        else if (response.ok && method === 'GET' && ['schedule','command','fleet'].includes(operation) && pathname === `/api/desktop/${operation}` && !(new URL(response.url || String(input), window.location.href)).searchParams.has('receipt')) {
          const category = operation;
          void response.clone().json().then(body => { if (!validReadSnapshot(category, body)) report({ category, method, failure: 'invalid-response' }); }).catch(() => report({ category, method, failure: 'invalid-response' }));
        }
      }
      return response;
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (operation && name !== 'AbortError') report({ category: operation, method, failure: name === 'TimeoutError' ? 'timeout' : 'network' });
      throw error;
    }
  };
}
