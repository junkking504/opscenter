'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './phone-access.module.css';
import { readPhotoResponse } from './photo-response';

export type PhotoProgress = {ready:boolean;before:boolean;after:boolean;verified:number};
type Photo = {requestId:string;category:'before'|'after';status:'selected'|'pending'|'verified'|'uncertain';image?:string};
const database='ops-crew-photo-drafts-v1';
function db():Promise<IDBDatabase> {return new Promise((resolve,reject)=>{const request=indexedDB.open(database,1);request.onupgradeneeded=()=>request.result.createObjectStore('drafts');request.onsuccess=()=>{const database=request.result;const transaction=database.transaction('drafts','readwrite');const cursor=transaction.objectStore('drafts').openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(row){if(!row.value?.at || Date.now()-row.value.at>=24*60*60_000)row.delete();row.continue();}};transaction.oncomplete=()=>resolve(database);transaction.onerror=()=>{database.close();reject(transaction.error);};};request.onerror=()=>reject(request.error);});}
export async function clearCrewPhotoDrafts() {const database=await db();try{await new Promise<void>((resolve,reject)=>{const transaction=database.transaction('drafts','readwrite');transaction.objectStore('drafts').clear();transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);});}finally{database.close();}}
async function stored(key:string,value?:Photo[]) {
  const database=await db();
  try{return await new Promise<Photo[]>((resolve,reject)=>{
    const transaction=database.transaction('drafts',value?'readwrite':'readonly'),store=transaction.objectStore('drafts');
    const request=value?store.put({at:Date.now(),photos:value},key):store.get(key);
    transaction.oncomplete=()=>resolve(value || (request.result && Date.now()-request.result.at<24*60*60_000 ? request.result.photos : []));
    transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
  });}finally{database.close();}
}
async function photoImage(file:File):Promise<string> {
  if(!file.type.startsWith('image/') || file.size>25*1024*1024)throw new Error('Choose an image smaller than 25 MB.');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    const scale=Math.min(1,2000/Math.max(image.width,image.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('Photo preparation is unavailable.');
    context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    const result=canvas.toDataURL('image/jpeg',.85);
    if(result.length>5.5*1024*1024)throw new Error('This image is too large. Choose a smaller photo.');
    return result;
  }finally{URL.revokeObjectURL(url);}
}
export default function JobPhotos({deviceId,assignmentId,onBusyChange,category:visibleCategory,onProgress}:{deviceId:string;assignmentId:string;onBusyChange:(busy:boolean)=>void;category?:'before'|'after';onProgress?:(progress:PhotoProgress)=>void}) {
  const [photos,setPhotos]=useState<Photo[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[reload,setReload]=useState(0);
  const inFlight=useRef(false),rows=useRef<Photo[]>([]);
  const key=`${deviceId}:${assignmentId}`;
  const save=useCallback(async(next:Photo[])=>{await stored(key,next);rows.current=next;setPhotos(next);},[key]);
  useEffect(()=>{
    let canceled=false;
    void(async()=>{
      try{
        setError('');setReady(false);
        let local:Photo[];
        try { local=await stored(key); } catch { throw new Error('Photo storage is unavailable on this phone. Allow website storage, then check saved photos again.'); }
        const response=await fetch(`/api/crew-jobs/photos?assignmentId=${encodeURIComponent(assignmentId)}`,{cache:'no-store'});
        const body=await readPhotoResponse(response);if(!response.ok)throw new Error(body.error || 'Photo history unavailable.');
        if(!Array.isArray(body.photos))throw new Error('Photo history could not be checked. Try again.');
        const remote=body.photos as Photo[];
        const merged=local.map(row=>{const saved=remote.find(item=>item.requestId===row.requestId);return saved?{...row,...saved,...(saved.status==='verified'?{image:undefined}:{})}:row;});
        for(const row of remote)if(!merged.some(item=>item.requestId===row.requestId))merged.push(row);
        if(canceled)return;await save(merged);setReady(true);
      }catch(error){if(!canceled)setError(error instanceof Error?error.message:'Photo history unavailable.');}
    })();return()=>{canceled=true;};
  },[key,assignmentId,save,reload]);
  useEffect(()=>{
    const complete=(category:'before'|'after')=>ready && photos.some(row=>row.category===category && row.status==='verified') && photos.filter(row=>row.category===category).every(row=>row.status==='verified');
    onProgress?.({ready,before:complete('before'),after:complete('after'),verified:photos.filter(row=>row.status==='verified').length});
  },[photos,ready,onProgress]);
  async function work(action:()=>Promise<void>) {
    if(inFlight.current)return;inFlight.current=true;setBusy(true);onBusyChange(true);setError('');
    try{await action();}catch(error){setError(error instanceof Error?error.message:'Photo result unavailable. Check saved result before retrying.');}
    finally{inFlight.current=false;setBusy(false);onBusyChange(false);}
  }
  async function select(files:File[],category:'before'|'after') {
    if(rows.current.filter(row=>row.status!=='verified').length+files.length>10)throw new Error('Upload the selected photos before adding more.');
    const added:Photo[]=[];
    for(const file of files)added.push({requestId:crypto.randomUUID(),category,status:'selected',image:await photoImage(file)});
    await save([...rows.current,...added]);
  }
  async function upload(row:Photo) {
    if(!row.image || row.status!=='selected')return;
    const pending={...row,status:'pending' as const};
    await save(rows.current.map(item=>item.requestId===row.requestId?pending:item));
    try {
      const response=await fetch('/api/crew-jobs/photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:row.requestId,assignmentId,category:row.category,image:row.image}),signal:AbortSignal.timeout(210_000)});
      const body=await readPhotoResponse(response);
      if(!body.receipt)throw new Error(body.error || 'Photo result unavailable. Check saved result.');
      await save(rows.current.map(item=>item.requestId===row.requestId?{...item,...(body.receipt as Photo),...((body.receipt as Photo).status==='verified'?{image:undefined}:{})}:item));
    }catch(error){await save(rows.current.map(item=>item.requestId===row.requestId?{...item,status:'uncertain'}:item));throw error;}
  }
  async function check(row:Photo) {
    const response=await fetch(`/api/crew-jobs/photos?assignmentId=${encodeURIComponent(assignmentId)}&requestId=${encodeURIComponent(row.requestId)}`,{cache:'no-store',signal:AbortSignal.timeout(210_000)});
    const body=await readPhotoResponse(response);
    if(response.status===404 && row.image){
      // No source write is retried here. The next explicit upload reuses this UUID;
      // the server returns its durable receipt if the original request is still arriving.
      await save(rows.current.map(item=>item.requestId===row.requestId?{...item,status:'selected'}:item));return;
    }
    if(!response.ok || !body.receipt)throw new Error(body.error || 'Saved photo result unavailable.');
    await save(rows.current.map(item=>item.requestId===row.requestId?{...item,...(body.receipt as Photo),...((body.receipt as Photo).status==='verified'?{image:undefined}:{})}:item));
  }
  return <section className={styles.card}><h2>{visibleCategory==='before'?'Before photos':visibleCategory==='after'?'After photos':'Job photos'}</h2><p>{visibleCategory ? `Upload ${visibleCategory} photos, then continue when they show Saved in JunkWare.` : 'At least one photo must be saved in JunkWare before closeout.'}</p>
    {!ready && !error && <p role="status">Checking saved photos…</p>}
    {(visibleCategory ? [visibleCategory] : ['before','after'] as const).map(category=><div className={styles.photoSection} key={category}><h3>{category==='before'?'Before':'After'}</h3>
      <label className={styles.secondary}>Add {category} photos<input aria-label={`Add ${category} photos`} type="file" accept="image/*" multiple disabled={busy || !ready} onChange={event=>{const files=Array.from(event.target.files || []);event.target.value='';void work(()=>select(files,category));}}/></label>
      {photos.filter(row=>row.category===category).map(row=><div className={styles.photo} key={row.requestId}>
        {/* Local camera/library preview; never sent to an image optimization service. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {row.image && <img src={row.image} alt={`${category} job photo selected for upload`}/>}
        <p role="status">{row.status==='verified'?'Saved in JunkWare':row.status==='selected'?'Selected · not uploaded':row.status==='pending'?'Upload result pending':'Verification required · do not upload again'}</p>
        {row.status==='selected'?<><button className={styles.primary} disabled={busy} onClick={()=>void work(()=>upload(row))}>Upload photo</button><button className={styles.secondary} disabled={busy} onClick={()=>void work(()=>save(rows.current.filter(item=>item.requestId!==row.requestId)))}>Remove selected photo</button></>:row.status!=='verified'?<button className={styles.secondary} disabled={busy} onClick={()=>void work(()=>check(row))}>Check saved photo</button>:null}
      </div>)}
    </div>)}
    {busy && <p role="status">Working on this photo…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!ready && error && <button className={styles.secondary} disabled={busy} onClick={()=>setReload(value=>value+1)}>Check saved photos again</button>}
    <p className={styles.muted}>Selected photos can be recovered on this company phone for 24 hours. Uploads start only when you tap Upload photo.</p>
  </section>;
}
