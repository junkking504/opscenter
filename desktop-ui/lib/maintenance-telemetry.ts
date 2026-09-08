// Fixed categories only; no raw errors, URLs, request bodies, or customer data.
export function installMaintenanceTelemetry() {
  const original = window.fetch.bind(window);
  const sent: Record<string, number> = {};
  const report = (category: string) => {
    const now = Date.now(); if (now - (sent[category] || 0) < 60_000) return;
    sent[category] = now;
    void original('/api/desktop/maintenance', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category }), signal: AbortSignal.timeout(5000) }).catch(() => {});
  };
  window.addEventListener('error', () => report('javascript'));
  window.addEventListener('unhandledrejection', event => { if (event.reason?.name !== 'AbortError') report('javascript'); });
  window.fetch = async (input, init) => {
    let category = '';
    try {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
      if (url.origin === window.location.origin) category = url.pathname.match(/^\/api\/desktop\/(schedule|command|control)(?:\/|$)/)?.[1] || '';
    } catch { /* preserve fetch's original validation */ }
    try { const response = await original(input, init); if (category && response.status >= 500) report(category); return response; }
    catch (error) { if (category && !(error instanceof DOMException && error.name === 'AbortError')) report(category); throw error; }
  };
}
