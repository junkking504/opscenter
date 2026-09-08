export type OperationReceipt = {
  requestId: string;
  status: 'pending' | 'verified' | 'failed' | 'uncertain';
  message: string;
  sourceResult?: Record<string, unknown>;
};

/** Submit exactly once. A lost response is not evidence that JunkWare failed. */
export async function submitScheduleOperation(
  payload: Record<string, unknown> & { requestId: string },
  dependencies: { fetch?: typeof fetch; now?: () => number; pause?: (ms: number) => Promise<void> } = {},
): Promise<OperationReceipt> {
  const request = dependencies.fetch || fetch;
  const now = dependencies.now || Date.now;
  const pause = dependencies.pause || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const deadline = now() + 10 * 60_000;
  try {
    const response = await request('/api/desktop/schedule/operations', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(210_000),
    });
    const body = await response.json();
    if (body.receipt && body.receipt.status !== 'pending') return body.receipt;
    if (!body.receipt && [400, 401, 403, 404, 409, 422].includes(response.status)) {
      return { requestId: payload.requestId, status: 'failed', message: body.error || 'The appointment change was rejected.' };
    }
  } catch { /* The durable receipt, not the connection, determines the outcome. */ }
  while (now() < deadline) {
    try {
      const response = await request(`/api/desktop/schedule/operations?requestId=${encodeURIComponent(payload.requestId)}`, {
        credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 401 || response.status === 403) break;
      const body = await response.json();
      if (body.receipt && body.receipt.status !== 'pending') return body.receipt;
    } catch { /* A read can be retried; the POST must not be. */ }
    await pause(2_000);
  }
  return { requestId: payload.requestId, status: 'uncertain', message: 'Verification has not finished. Check Saved Result before another change; do not resubmit.' };
}
