/** IndexedDB keeps photos and answers together across page reloads. */
export async function inspectionDraft<T>(deviceId: string, action: "read" | "write" | "remove", value?: T): Promise<T | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("junk-king-truck-inspection", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction("drafts", action === "read" ? "readonly" : "readwrite");
      const store = tx.objectStore("drafts");
      const request = action === "read" ? store.get(deviceId) : action === "write" ? store.put(value, deviceId) : store.delete(deviceId);
      tx.oncomplete = () => resolve(action === "read" ? request.result : undefined);
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
