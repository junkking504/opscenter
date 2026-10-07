import type { CheckoutPhoto } from './photo-checkout';
import type { Receipt } from '../../desktop-ui/schedule-receipt';
import { crewCloseoutKey, writeCloseoutLocal } from '../../desktop-ui/lib/closeout-drafts';
import { storedPhotos } from './photo-storage';

export type CheckoutHandoff = {
  draftKey?: string; photoKey?: string;
  deviceId: string; assignmentId: string; requestId: string; createdAt: number;
  phase: 'transferring' | 'submitting' | 'accepted' | 'attention';
  payload: Record<string, unknown> & { requestId: string };
  photoIds: string[]; acceptedPhotos: Record<string, string>; message: string; receipt?: Receipt;
};
export const HANDOFF_EVENT = 'waypoint-checkout-handoff';
const keyFor = (device: string, assignment: string) => `${crewCloseoutKey(device, assignment)}:handoff`;
export function saveHandoff(value: CheckoutHandoff) {
  // Must succeed before any network write. This is a confirmed intent, not a
  // draft with a silent 24-hour expiration or proof of server acceptance.
  localStorage.setItem(keyFor(value.deviceId, value.assignmentId), JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(HANDOFF_EVENT, { detail: value }));
}
/** A server-declared reset retires the intent without deleting its evidence. */
export function retireHandoff(deviceId:string,assignmentId:string) {
  const key=keyFor(deviceId,assignmentId),raw=localStorage.getItem(key);
  if(raw===null)return;
  localStorage.setItem(`${key}:retired:${Date.now()}:${crypto.randomUUID()}`,raw);
  localStorage.removeItem(key);
}
export function readHandoffs(deviceId: string): CheckoutHandoff[] {
  const prefix = `${crewCloseoutKey(deviceId, '')}`;
  return Object.keys(localStorage).filter(key => key.startsWith(prefix) && key.endsWith(':handoff')).flatMap(key => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null') as CheckoutHandoff;
      return value?.deviceId === deviceId && value.requestId && Array.isArray(value.photoIds) ? [value] : [];
    } catch { return []; }
  });
}
export function draftHandoff(deviceId:string,draftKey:string,assignmentIds:string[]) {
  const matches=readHandoffs(deviceId).filter(value=>value.draftKey===draftKey || assignmentIds.includes(value.assignmentId)).sort((a,b)=>b.createdAt-a.createdAt);
  return matches.find(value=>!value.receipt || !['failed','reconciled'].includes(value.receipt.status)) || matches[0];
}
export function reopenAttentionHandoff(value: CheckoutHandoff): CheckoutHandoff | null {
  if (value.phase !== 'attention' || value.receipt) return null;
  const photosAccepted = value.photoIds.every(id => Boolean(value.acceptedPhotos[id]));
  return { ...value, phase: photosAccepted ? 'submitting' : 'transferring',
    message: 'Rechecking the exact saved checkout. No new payment request will be created.' };
}
export function retryAttentionHandoff(value: CheckoutHandoff) {
  const reopened = reopenAttentionHandoff(value);
  if (!reopened) return Promise.resolve<Receipt | null>(null);
  saveHandoff(reopened);
  return resumeHandoff(reopened);
}
export async function createHandoff(deviceId: string, assignmentId: string, payload: CheckoutHandoff['payload'], storage?:{draftKey:string;photoKey:string;assignmentIds:string[]}) {
  const saved = readHandoffs(deviceId);
  if (saved.some(value => value.assignmentId !== assignmentId && (['transferring', 'submitting'].includes(value.phase) || value.receipt?.status === 'pending'))) {
    throw new Error('Another checkout is still finishing. You can view other assignments while its saved submission completes.');
  }
  const matching=saved.filter(value=>value.assignmentId===assignmentId || Boolean(storage && (value.draftKey===storage.draftKey || storage.assignmentIds.includes(value.assignmentId))));
  if(matching.some(value=>!value.receipt || !['failed','reconciled'].includes(value.receipt.status))){
    throw new Error('This checkout already has a saved submission. Resume or check its saved result; do not submit another payment.');
  }
  const photos = await storedPhotos(storage?.photoKey || `${deviceId}:${assignmentId}`);
  if(photos.some(photo=>photo.assignmentId && photo.assignmentId!==assignmentId && photo.status!=='verified' && photo.status!=='selected'))throw new Error('A photo from the earlier assignment still needs verification. Check its saved result before submitting.');
  const value: CheckoutHandoff = { deviceId, assignmentId, requestId: payload.requestId,
    createdAt: Date.now(), payload, ...(storage?{draftKey:storage.draftKey,photoKey:storage.photoKey}:{}), phase: 'transferring',
    photoIds: photos.filter(photo => photo.status !== 'verified').map(photo => photo.requestId),
    acceptedPhotos: {}, message: 'Securing photos and checkout on OpsCenter. Stay on this screen until the server confirms the save.' };
  saveHandoff(value);
  return value;
}

type Dependencies = {
  fetch: typeof fetch; photos: () => Promise<CheckoutPhoto[]>;
  save: (handoff: CheckoutHandoff) => void; keepReceipt: (receipt: Receipt) => void;
};
class NeedsAttention extends Error {}
/** Recover receipt first; only repeat an identical idempotent intake, never a
 * JunkWare write or a payment with a new request identity. */
export async function transferCheckout(initial: CheckoutHandoff, dependencies: Dependencies): Promise<Receipt | null> {
  let handoff = initial;
  const update = (patch: Partial<CheckoutHandoff>) => { handoff = { ...handoff, ...patch }; dependencies.save(handoff); };
  const endpoint = `/api/crew-jobs/closeout?assignmentId=${encodeURIComponent(handoff.assignmentId)}`;
  const accept = (receipt: Receipt) => {
    if (receipt.requestId !== handoff.requestId) throw new NeedsAttention('Another checkout needs office review. Do not submit again.');
    dependencies.keepReceipt(receipt);
    update({ receipt, phase: ['pending', 'verified'].includes(receipt.status) ? 'accepted' : 'attention', message:
      receipt.status === 'verified' ? 'Closed out · verified in JunkWare.' : receipt.status === 'pending'
        ? 'Safe to close Waypoint. Photos and checkout are saved on the server; JunkWare verification is still pending.'
        : `Checkout needs attention. ${receipt.message} Do not enter another payment.` });
    return receipt;
  };
  const read = async (url: string) => {
    const response = await dependencies.fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (response.status === 404) return null;
    const body = await response.json();
    if (!response.ok) {
      if ([401, 403, 409].includes(response.status)) throw new NeedsAttention(body.error || 'Phone or assignment access changed. Contact the office.');
      throw new Error(body.error || 'Server receipt could not be checked.');
    }
    if (!body.receipt) throw new Error('Server receipt could not be checked.');
    return body.receipt;
  };
  try {
    const existing = await read(`${endpoint}&requestId=${encodeURIComponent(handoff.requestId)}`);
    if (existing) return accept(existing);
    if (handoff.phase === 'accepted' || handoff.receipt) throw new NeedsAttention('The accepted server receipt is unavailable. Ask the office to check; do not resubmit.');
    if (handoff.phase === 'attention') return null;
    if (handoff.phase === 'transferring') {
      const photos = await dependencies.photos();
      const missing = handoff.photoIds.filter(id => !handoff.acceptedPhotos[id]);
      let next = 0;
      let failure: unknown;
      const progress = () => update({ message: `Photos saved on server: ${handoff.photoIds.filter(id => handoff.acceptedPhotos[id]).length} of ${handoff.photoIds.length}. Keep Waypoint open while the rest transfer.` });
      progress();
      const transferPhoto = async (id: string) => {
        let receipt = await read(`/api/crew-jobs/photos?assignmentId=${encodeURIComponent(handoff.assignmentId)}&requestId=${encodeURIComponent(id)}&receiptOnly=1`);
        if (failure) return;
        if (!receipt) {
          const photo = photos.find(row => row.requestId === id);
          if (!photo?.image) throw new NeedsAttention('A photo is missing from this phone and has no server receipt. Reopen the assignment to review the photos. No checkout was submitted.');
          const response = await dependencies.fetch('/api/crew-jobs/photos', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: id, assignmentId: handoff.assignmentId, category: photo.category, image: photo.image }), signal: AbortSignal.timeout(60_000) });
          const body = await response.json();
          if (!response.ok || !body.receipt) {
            if ([400, 401, 403, 409, 413, 422].includes(response.status)) throw new NeedsAttention(body.error || 'Photo transfer needs review.');
            throw new Error(body.error || 'Photo transfer was interrupted.');
          }
          receipt = body.receipt;
        }
        if (!['pending', 'verified'].includes(receipt.status)) throw new NeedsAttention('A photo needs JunkWare verification. Reopen the assignment and check saved photos; do not upload it again.');
        update({ acceptedPhotos: { ...handoff.acceptedPhotos, [id]: receipt.requestId } });
        progress();
      };
      // Two phone-to-server transfers overlap network latency. Provider writes
      // retain their existing appointment lock. Drain both workers before
      // returning so a late acknowledgment cannot overwrite a paused handoff.
      const worker = async () => {
        while (!failure && next < missing.length) {
          const id = missing[next++];
          try { await transferPhoto(id); }
          catch (error) { if (!failure || error instanceof NeedsAttention) failure = error; }
        }
      };
      await Promise.all([worker(), worker()]);
      if (failure) throw failure;
      update({ phase: 'submitting', payload: { ...handoff.payload, photoRequestIds: [...new Set(handoff.photoIds.map(id => handoff.acceptedPhotos[id]))] },
        message: 'Photos are secure. Saving the checkout on the server.' });
    }
    // The immutable body and UUID were persisted above. A lost response is
    // recovered on reopening by GET first, then this same idempotent intake.
    const response = await dependencies.fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(handoff.payload), signal: AbortSignal.timeout(30_000) });
    const body = await response.json();
    if (body.receipt) return accept(body.receipt);
    if ([400, 401, 403, 404, 409, 422].includes(response.status)) throw new NeedsAttention(body.error || 'Checkout was rejected. Reopen the assignment to review it.');
    throw new Error('Checkout acceptance has not been confirmed.');
  } catch (error) {
    update({ ...(error instanceof NeedsAttention ? { phase: 'attention' } : {}), message: error instanceof NeedsAttention ? error.message
      : 'Transfer paused · not yet safe to close. Your submission is saved on this phone. Keep this checkout open and tap Check Saved Result to continue the same submission.' });
    return null;
  }
}
const running = new Map<string, Promise<Receipt | null>>();
export function resumeHandoff(handoff: CheckoutHandoff) {
  const key = keyFor(handoff.deviceId, handoff.assignmentId);
  const prior = running.get(key);
  if (prior) return prior;
  const work = transferCheckout(handoff, { fetch: (...args) => fetch(...args), photos: () => storedPhotos(handoff.photoKey || `${handoff.deviceId}:${handoff.assignmentId}`), save: saveHandoff,
    keepReceipt: receipt => writeCloseoutLocal(`${crewCloseoutKey(handoff.deviceId, handoff.assignmentId)}:receipt`, receipt) }).finally(() => running.delete(key));
  running.set(key, work);
  return work;
}
