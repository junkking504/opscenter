'use client';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import styles from './phone-access.module.css';
import { readPhotoResponse } from './photo-response';

import {submitCheckoutPhotos, type CheckoutPhoto as Photo} from './photo-checkout';
export type PhotoProgress = {ready:boolean;count:number;verified:number};
export type PhotoCheckoutHandle = {submit:(progress:(message:string)=>void)=>Promise<void>};
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
export default function JobPhotos({deviceId,assignmentId,onBusyChange,category:visibleCategory,onProgress,deferred=false,locked=false,dryRun=false,ref}:{deviceId:string;assignmentId:string;onBusyChange:(busy:boolean)=>void;category?:'before'|'after';onProgress?:(progress:PhotoProgress)=>void;deferred?:boolean;locked?:boolean;dryRun?:boolean;ref?:Ref<PhotoCheckoutHandle>}) {
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
    onProgress?.({ready,count:photos.length,verified:photos.filter(row=>row.status==='verified').length});
  },[photos,ready,onProgress]);
  async function work(action:()=>Promise<void>) {
    if(inFlight.current)return;inFlight.current=true;setBusy(true);onBusyChange(true);setError('');
    try{await action();}catch(error){setError(error instanceof Error?error.message:'Photo result unavailable. Check saved result before retrying.');}
    finally{inFlight.current=false;setBusy(false);onBusyChange(false);}
  }
  async function select(files:File[],category:'before'|'after') {
    if(rows.current.filter(row=>row.status!=='verified').length+files.length>10)throw new Error('Choose up to 10 photos for this checkout. Remove a selected photo before adding more.');
    const added:Photo[]=[];
    for(const file of files)added.push({requestId:crypto.randomUUID(),category,status:'selected',image:await photoImage(file)});
    await save([...rows.current,...added]);
  }
  async function upload(row:Photo) {
    if(!row.image || row.status!=='selected')throw new Error('This photo is unavailable. Return to photos and choose it again.');
    const pending={...row,status:'pending' as const};
    await save(rows.current.map(item=>item.requestId===row.requestId?pending:item));
    try {
      const response=await fetch('/api/crew-jobs/photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:row.requestId,assignmentId,category:row.category,image:row.image}),signal:AbortSignal.timeout(210_000)});
      const body=await readPhotoResponse(response);
      if(!body.receipt)throw new Error(body.error || 'Photo result unavailable. Check saved result.');
      const result={...row,...(body.receipt as Photo),...((body.receipt as Photo).status==='verified'?{image:undefined}:{})};
      await save(rows.current.map(item=>item.requestId===row.requestId?result:item));return result;
    }catch(error){const uncertain={...row,status:'uncertain' as const};await save(rows.current.map(item=>item.requestId===row.requestId?uncertain:item));if(deferred)return uncertain;throw error;}
  }
  async function check(row:Photo) {
    const response=await fetch(`/api/crew-jobs/photos?assignmentId=${encodeURIComponent(assignmentId)}&requestId=${encodeURIComponent(row.requestId)}`,{cache:'no-store',signal:AbortSignal.timeout(210_000)});
    const body=await readPhotoResponse(response);
    if(response.status===404 && row.image){
      // No source write is retried here. The next explicit upload reuses this UUID;
      // the server returns its durable receipt if the original request is still arriving.
      const selected={...row,status:'selected' as const};await save(rows.current.map(item=>item.requestId===row.requestId?selected:item));return selected;
    }
    if(!response.ok || !body.receipt)throw new Error(body.error || 'Saved photo result unavailable.');
    const result={...row,...(body.receipt as Photo),...((body.receipt as Photo).status==='verified'?{image:undefined}:{})};
    await save(rows.current.map(item=>item.requestId===row.requestId?result:item));return result;
  }
  useImperativeHandle(ref,()=>({submit:async(progress)=>{
    if(!ready || inFlight.current)throw new Error('Photos are still loading. Wait a moment, then submit checkout.');
    inFlight.current=true;setBusy(true);onBusyChange(true);setError('');
    try {await submitCheckoutPhotos([...rows.current],{upload,check,progress});}
    catch(error){setError(error instanceof Error?error.message:'Photo verification is pending.');throw error;}
    finally{inFlight.current=false;setBusy(false);onBusyChange(false);}
  }}));
  return <section className={styles.card}><h2>{visibleCategory==='before'?'Before photos':visibleCategory==='after'?'After photos':'Job photos'}</h2><p>{dryRun ? "Choose photos to test this checkout. The files will stay on this phone." : deferred ? `Choose ${visibleCategory || 'job'} photos now. They will upload when you submit the completed checkout.` : 'Upload job photos and check the saved result.'}</p>
    {!ready && !error && <p role="status">Checking saved photos…</p>}
    {(visibleCategory ? [visibleCategory] : ['before','after'] as const).map(category=><div className={styles.photoSection} key={category}><h3>{category==='before'?'Before':'After'}</h3>
      <label className={styles.secondary}>Add {category} photos<input aria-label={`Add ${category} photos`} type="file" accept="image/*" multiple disabled={busy || locked || !ready} onChange={event=>{const files=Array.from(event.target.files || []);event.target.value='';void work(()=>select(files,category));}}/></label>
      {photos.filter(row=>row.category===category).map(row=><div className={styles.photo} key={row.requestId}>
        {/* Local camera/library preview; never sent to an image optimization service. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {row.image && <img src={row.image} alt={`${category} job photo selected for upload`}/>}
        <p role="status">{row.status==='verified'?'Saved in JunkWare':row.status==='selected'?(deferred?'Ready to submit':'Selected · not uploaded'):row.status==='pending'?'Upload result pending':deferred?'Will check the saved result when you submit checkout':'Verification required · do not upload again'}</p>
        {row.status==='selected'?<>{!deferred && <button className={styles.primary} disabled={busy || locked} onClick={()=>void work(async()=>{await upload(row);})}>Upload photo</button>}<button className={styles.secondary} disabled={busy || locked} onClick={()=>void work(()=>save(rows.current.filter(item=>item.requestId!==row.requestId)))}>Remove selected photo</button></>:!deferred && row.status!=='verified'?<button className={styles.secondary} disabled={busy || locked} onClick={()=>void work(async()=>{await check(row);})}>Check saved photo</button>:null}
      </div>)}
    </div>)}
    {busy && <p role="status">Working on this photo…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!ready && error && <button className={styles.secondary} disabled={busy || locked} onClick={()=>setReload(value=>value+1)}>Check saved photos again</button>}
    <p className={styles.muted}>Selected photos stay on this phone for 24 hours. {dryRun?'This is a dry run. No photos will be uploaded.':deferred?'Finish Charges and Payment, then submit checkout to upload everything. Keep this page open until the result is shown.':'Uploads start only when you tap Upload photo.'}</p>
  </section>;
}
