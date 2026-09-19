type PhotoResponse = {error?:string; photos?:unknown; receipt?:unknown};
export async function readPhotoResponse(response: Response): Promise<PhotoResponse> {
  let body: PhotoResponse;
  try { body = await response.json(); }
  catch { throw new Error('Photo service could not respond. Check your connection, then check saved photos again.'); }
  if (!body || typeof body !== 'object') throw new Error('Photo service could not respond. Check saved photos again.');
  if (!response.ok && response.status !== 404 && !body.receipt) throw new Error(body.error || 'Saved photos could not be checked. Try again.');
  return body;
}
