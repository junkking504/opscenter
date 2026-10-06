import type { CheckoutPhoto } from './photo-checkout';
const databaseName = 'ops-crew-photo-drafts-v1';
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    // Reads and migrations must not garbage-collect the only recovery copy.
    request.onsuccess = () => resolve(request.result);
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
export async function clearCrewPhotoDraft(key:string) {
  const database=await db();
  try {await new Promise<void>((resolve,reject)=>{
    const transaction=database.transaction('drafts','readwrite');
    transaction.objectStore('drafts').delete(key);
    transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);
  });} finally {database.close();}
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

/** Copy aliases once in one transaction. Keep original bytes and request IDs.
 * The destination's presence (including an empty list) wins after migration. */
export async function migratePhotoDraft(key:string,aliases:string[]) {
  const database=await db();
  try {await new Promise<void>((resolve,reject)=>{
    const transaction=database.transaction('drafts','readwrite'),store=transaction.objectStore('drafts');
    const current=store.get(key);
    current.onsuccess=()=>{
      if(current.result!==undefined)return;
      const merged=new Map<string,CheckoutPhoto>();let remaining=aliases.length;
      const finish=()=>{if(--remaining===0)store.put({at:Date.now(),photos:[...merged.values()]},key);};
      if(!remaining){store.put({at:Date.now(),photos:[]},key);return;}
      for(const alias of aliases){const request=store.get(alias);request.onsuccess=()=>{
        try {
          for(const row of request.result?.photos || []){
            const candidate={...row,...(row.status!=='selected'?{assignmentId:row.assignmentId || alias.slice(alias.indexOf(':')+1)}:{})};
            merged.set(row.requestId,mergePhotoAlias(merged.get(row.requestId),candidate));
          }
          finish();
        }catch(error){reject(error);transaction.abort();}
      };}
    };
    transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
  });}finally{database.close();}
}

/** Never turn an acknowledged or unknown upload back into a fresh selection. */
export function mergePhotoAlias(prior:CheckoutPhoto|undefined,next:CheckoutPhoto):CheckoutPhoto {
  if(!prior)return next;
  if(prior.category!==next.category || (prior.image && next.image && prior.image!==next.image) || (prior.assignmentId && next.assignmentId && prior.assignmentId!==next.assignmentId))throw new Error('Conflicting saved photo copies were preserved. Contact the office before submitting.');
  const rank=(photo:CheckoutPhoto)=>photo.status==='verified'?3:photo.status==='selected'?0:2;
  const winner=rank(next)>rank(prior)?next:prior;
  return {...winner,image:prior.image || next.image,...(winner.status==='pending'?{status:'uncertain'}:{})};
}
