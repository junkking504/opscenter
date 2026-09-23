'use client';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import styles from './phone-access.module.css';
import { readPhotoResponse } from './photo-response';
import {MAX_CHECKOUT_PHOTOS} from '@/lib/crew-photo-limits';

import {stageCheckoutPhotos, type CheckoutPhoto as Photo} from './photo-checkout';
import {storedPhotos as stored} from './photo-storage';
export {clearCrewPhotoDrafts} from './photo-storage';
export type PhotoProgress = {ready:boolean;count:number;verified:number};
export type PhotoCheckoutHandle = {ready:()=>boolean;submit:(progress:(message:string)=>void)=>Promise<string[]>};
async function photoImage(file:File):Promise<string> {
  if(!file.type.startsWith('image/') || file.size>25*1024*1024)throw new Error('Choose an image smaller than 25 MB.');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    const scale=Math.min(1,2000/Math.max(image.width,image.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('Photo preparation is unavailable.');
    context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('This photo could not be prepared.')),'image/jpeg',.85));
    const result=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('This photo could not be read.'));reader.readAsDataURL(blob);});
    if(result.length>5.5*1024*1024)throw new Error('This image is too large. Choose a smaller photo.');
    return result;
  }finally{URL.revokeObjectURL(url);}
}
export default function JobPhotos({deviceId,assignmentId,onBusyChange,category:visibleCategory,onProgress,deferred=false,locked=false,dryRun=false,ref}:{deviceId:string;assignmentId:string;onBusyChange:(busy:boolean)=>void;category?:'before'|'after';onProgress?:(progress:PhotoProgress)=>void;deferred?:boolean;locked?:boolean;dryRun?:boolean;ref?:Ref<PhotoCheckoutHandle>}) {
  const [photos,setPhotos]=useState<Photo[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[reload,setReload]=useState(0);
  const [previews,setPreviews]=useState<Array<{url:string;category:'before'|'after'}>>([]),[preparing,setPreparing]=useState('');
  const inFlight=useRef(false),rows=useRef<Photo[]>([]);
  const key=`${deviceId}:${assignmentId}`;
  const save=useCallback(async(next:Photo[])=>{const unique=[...new Map(next.map(row=>[row.requestId,row])).values()];await stored(key,unique);rows.current=unique;setPhotos(unique);},[key]);
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
        const merged=local.map(row=>{const saved=remote.find(item=>item.requestId===row.requestId);return saved?{...row,...saved,...(saved.status==='verified'?{image:undefined}:{})}:row.status==='pending'?{...row,status:'uncertain' as const}:row;});
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
    const remaining=MAX_CHECKOUT_PHOTOS-rows.current.filter(row=>row.status!=='verified').length;
    if(files.length>remaining)throw new Error(`You can add ${remaining} more photos. The ${MAX_CHECKOUT_PHOTOS}-photo limit includes Before and After together.`);
    if(files.some(file=>!file.type.startsWith('image/') || file.size>25*1024*1024))throw new Error('Choose images smaller than 25 MB each.');
    const selected=files.map(file=>({url:URL.createObjectURL(file),category}));
    setPreviews(selected);
    const added:Photo[]=[];
    try{
      // Paint camera/library previews immediately, before decoding and resizing.
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      for(const [index,file] of files.entries()){
        setPreparing(`Preparing photo ${index+1} of ${files.length}…`);
        added.push({requestId:crypto.randomUUID(),category,status:'selected',image:await photoImage(file)});
      }
    }finally{
      // Keep successfully prepared photos even if a later file cannot decode.
      try{if(added.length)await save([...rows.current,...added]);}
      finally{setPreviews([]);setPreparing('');selected.forEach(row=>URL.revokeObjectURL(row.url));}
    }
  }
  async function upload(row:Photo) {
    if(!row.image || row.status!=='selected')throw new Error('This photo is unavailable. Return to photos and choose it again.');
    // Until the server acknowledges durable storage, this is NOT pending
    // provider work. A killed browser must check/resend the original intake.
    const pending={...row,status:'uncertain' as const};
    await save(rows.current.map(item=>item.requestId===row.requestId?pending:item));
    try {
      const response=await fetch('/api/crew-jobs/photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:row.requestId,assignmentId,category:row.category,image:row.image}),signal:AbortSignal.timeout(210_000)});
      const body=await readPhotoResponse(response);
      if(!body.receipt)throw new Error(body.error || 'Photo result unavailable. Check saved result.');
      const result={...row,...(body.receipt as Photo),...(['pending','verified'].includes((body.receipt as Photo).status)?{image:undefined}:{})};
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
  useImperativeHandle(ref,()=>({ready:()=>ready&&!inFlight.current,submit:async(progress)=>{
    if(!ready || inFlight.current)throw new Error('Photos are still loading. Wait a moment, then submit checkout.');
    inFlight.current=true;setBusy(true);onBusyChange(true);setError('');
    try {return await stageCheckoutPhotos([...rows.current],{upload,check,progress});}
    catch(error){setError(error instanceof Error?error.message:'Photo verification is pending.');throw error;}
    finally{inFlight.current=false;setBusy(false);onBusyChange(false);}
  }}));
  return <section className={styles.card}><h2>{visibleCategory==='before'?'Before photos':visibleCategory==='after'?'After photos':'Job photos'}</h2><p>{dryRun ? "Choose photos to test this checkout. The files will stay on this phone." : deferred ? `Choose ${visibleCategory || 'job'} photos now. They will upload when you submit the completed checkout.` : 'Upload job photos and check the saved result.'}</p>
    {!ready && !error && <p role="status">Checking saved photos…</p>}
    <p className={styles.muted}>{photos.filter(row=>row.status!=='verified').length} of {MAX_CHECKOUT_PHOTOS} selected · Before and After combined</p>
    {(visibleCategory ? [visibleCategory] : ['before','after'] as const).map(category=><div className={styles.photoSection} key={category}>
      <label className={styles.photoPicker}><strong>Add {category} photos</strong><span>Take photos or choose from this phone</span><input aria-label={`Add ${category} photos`} type="file" accept="image/*" multiple disabled={busy || locked || !ready} onChange={event=>{const files=Array.from(event.target.files || []);event.target.value='';void work(()=>select(files,category));}}/></label>
      <div className={styles.photoGrid}>
      {previews.filter(row=>row.category===category).map(row=><div className={styles.photo} key={row.url}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={row.url} alt={`${category} photo preview`}/><p>Preparing for checkout…</p>
      </div>)}
      {photos.filter(row=>row.category===category).map(row=><div className={styles.photo} key={row.requestId}>
        {/* Local camera/library preview; never sent to an image optimization service. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {row.image && <img src={row.image} alt={`${category} job photo selected for upload`}/>}
        <p role="status">{row.status==='verified'?'Saved in JunkWare':row.status==='selected'?(deferred?'Ready to submit':'Selected · not uploaded'):row.status==='pending'?'Finishing in background':deferred?'Check the saved result before checkout':'Verification required · do not upload again'}</p>
        {row.status==='selected'?<>{!deferred && <button className={styles.primary} disabled={busy || locked} onClick={()=>void work(async()=>{await upload(row);})}>Upload photo</button>}<button className={styles.secondary} disabled={busy || locked} onClick={()=>void work(()=>save(rows.current.filter(item=>item.requestId!==row.requestId)))}>Remove selected photo</button></>:!deferred && row.status!=='verified'?<button className={styles.secondary} disabled={busy || locked} onClick={()=>void work(async()=>{await check(row);})}>Check saved photo</button>:null}
      </div>)}
      </div>
    </div>)}
    {busy && <p role="status">{preparing || 'Saving photo selection…'}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!ready && error && <button className={styles.secondary} disabled={busy || locked} onClick={()=>setReload(value=>value+1)}>Check saved photos again</button>}
    <p className={styles.muted}>{dryRun?'This is a dry run. No photos will be uploaded.':deferred?'Tap Submit once and continue viewing assignments. Keep Waypoint open until “Safe to close” appears. If interrupted, reopen Waypoint to resume the saved transfer. Unsubmitted photo drafts expire after 24 hours.':'Selected photos stay on this phone for 24 hours. Uploads start only when you tap Upload photo.'}</p>
  </section>;
}
