import type {CheckoutPhoto} from './photo-checkout';
import {storedPhotos,updateStoredPhotos} from './photo-storage';

// The worker belongs to the photo draft, not the currently visible form step.
const running=new Map<string,Promise<void>>();
export function submittedPhotoStep(photos:CheckoutPhoto[],category:'before'|'after') {
  const rows=photos.filter(row=>row.category===category);
  return rows.length>0 && rows.every(row=>row.submitted || row.status!=='selected');
}
export async function submitPhotoStep(key:string,assignmentId:string,category:'before'|'after',dryRun=false) {
  await updateStoredPhotos(key,photos=>{
    const rows=photos.filter(row=>row.category===category);
    if(!rows.length)throw new Error(`Add at least one ${category} photo before continuing.`);
    if(rows.some(row=>row.status==='selected' && !row.image))throw new Error('A selected photo could not be saved. Choose it again before continuing.');
    return photos.map(row=>row.category===category && row.status==='selected'?{...row,submitted:true,assignmentId}:row);
  });
  // Do not await network intake or JunkWare verification to leave this step.
  if(!dryRun)void resumePhotoTransfers(key).catch(()=>undefined);
}
export function waitForPhotoTransfers(key:string) {return running.get(key) || Promise.resolve();}
export function resumePhotoTransfers(key:string):Promise<void> {
  const prior=running.get(key);if(prior)return prior;
  const work=transferSubmittedPhotos(key).finally(()=>running.delete(key));running.set(key,work);return work;
}
async function transferSubmittedPhotos(key:string) {
  const attempted=new Set<string>();
  while(true){
    const batch=(await storedPhotos(key)).filter(row=>row.submitted && row.assignmentId && row.status!=='verified' && !row.receiptId && !attempted.has(row.requestId)).slice(0,2);
    if(!batch.length)return;
    batch.forEach(row=>attempted.add(row.requestId));
    await Promise.all(batch.map(async row=>{
      const update=(patch:Partial<CheckoutPhoto>)=>updateStoredPhotos(key,photos=>photos.map(current=>current.requestId===row.requestId?{...current,...patch}:current));
      try{
        await update({status:'uncertain',transferError:undefined});
        const query=`assignmentId=${encodeURIComponent(row.assignmentId!)}&requestId=${encodeURIComponent(row.requestId)}&receiptOnly=1`;
        let response=await fetch(`/api/crew-jobs/photos?${query}`,{cache:'no-store',signal:AbortSignal.timeout(15_000)});
        let body=await response.json();
        if(response.status===404){
          if(!row.image)throw new Error('The saved photo is unavailable. Review this photo before checkout.');
          response=await fetch('/api/crew-jobs/photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:row.requestId,assignmentId:row.assignmentId,category:row.category,image:row.image}),signal:AbortSignal.timeout(60_000)});
          body=await response.json();
        }
        const receipt=body.receipt;
        if(!response.ok || !receipt?.requestId || !['pending','verified','uncertain'].includes(receipt.status))throw new Error(body.error || 'Photo transfer paused. Resume it when your connection returns.');
        await update({status:receipt.status,receiptId:receipt.requestId,...(receipt.status==='verified'?{image:undefined}:{}),transferError:receipt.status==='uncertain'?'This photo needs verification. Check its saved result before final checkout.':undefined});
      }catch(error){
        await update({status:'uncertain',transferError:error instanceof Error && !['TimeoutError','TypeError'].includes(error.name)?error.message:'Photo transfer paused. Your photo is saved on this phone; you can continue filling out the job.'});
      }
    }));
  }
}
