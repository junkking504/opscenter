/** Only deliberate, user-facing request errors may reach the search panel. */
export class SearchRequestError extends Error {}

export async function readSearchJson<T extends object>(response: Response, unavailable: string): Promise<T & { error?: string }> {
  if (response.status === 401 || (response.redirected && /\/login(?:[/?#]|$)/.test(response.url))) {
    throw new SearchRequestError('Your OpsCenter session has expired. Refresh the page and sign in again.');
  }
  if (response.redirected || !/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') || '')) {
    throw new SearchRequestError(unavailable);
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new SearchRequestError(unavailable); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SearchRequestError(unavailable);
  return body as T & { error?: string };
}

export function searchFailureMessage(failure: unknown, unavailable: string): string {
  if (failure instanceof SearchRequestError) return failure.message;
  if (failure instanceof Error && failure.name === 'TimeoutError') return `The request took too long. ${unavailable}`;
  return unavailable;
}
