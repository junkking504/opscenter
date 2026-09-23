import type { CheckoutPhoto } from './photo-checkout';
const databaseName = 'ops-crew-photo-drafts-v1';
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => {
      const database = request.result, transaction = database.transaction('drafts', 'readwrite');
      const cursor = transaction.objectStore('drafts').openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        let confirmed = false;
        try {
          const intent = JSON.parse(localStorage.getItem(`ops-crew-closeout:${row.key}:handoff`) || 'null');
          confirmed = Boolean(intent && !intent.receipt && ['transferring', 'submitting', 'attention'].includes(intent.phase));
        } catch { confirmed = true; /* Storage failure is not permission to discard a submission. */ }
        if (!confirmed && (!row.value?.at || Date.now() - row.value.at >= 24 * 60 * 60_000)) row.delete();
        row.continue();
      };
      transaction.oncomplete = () => resolve(database);
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
    request.onerror = () => reject(request.error);
  });
}
export async function clearCrewPhotoDrafts() {
  const database = await db();
  try { await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }); } finally { database.close(); }
}
export async function storedPhotos(key: string, value?: CheckoutPhoto[]): Promise<CheckoutPhoto[]> {
  const database = await db();
  try { return await new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', value ? 'readwrite' : 'readonly');
    const store = transaction.objectStore('drafts');
    const request = value ? store.put({ at: Date.now(), photos: value }, key) : store.get(key);
    // A confirmed handoff may outlive the ordinary draft. Do not garbage-collect
    // its only copy of untransferred photos merely because the browser was closed.
    transaction.oncomplete = () => resolve(value || request.result?.photos || []);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }); } finally { database.close(); }
}
