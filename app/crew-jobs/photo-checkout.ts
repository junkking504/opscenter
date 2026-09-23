export type CheckoutPhoto = {requestId:string;category:'before'|'after';status:'selected'|'pending'|'verified'|'uncertain';image?:string};

/** Final-confirmation only. Transfer each selected image to durable OpsCenter
 * storage, then let the server finish JunkWare upload and verification. */
export async function stageCheckoutPhotos(photos:CheckoutPhoto[],actions:{
  upload:(photo:CheckoutPhoto)=>Promise<CheckoutPhoto>;
  check:(photo:CheckoutPhoto)=>Promise<CheckoutPhoto>;
  progress:(message:string)=>void;
}):Promise<string[]> {
  const requestIds=new Set<string>();
  for(const [index,initial] of photos.entries()) {
    let photo=initial;
    if(photo.status==='verified')continue;
    actions.progress(`Transferring photo ${index+1} of ${photos.length}…`);
    if(photo.status==='uncertain')photo=await actions.check(photo);
    if(photo.status==='selected')photo=await actions.upload(photo);
    if(photo.status==='uncertain')throw new Error('A photo result needs verification. Check the saved photo before submitting checkout.');
    if(!['pending','verified'].includes(photo.status))throw new Error('A photo could not be transferred. Check the saved photo before submitting checkout.');
    // The server may return an existing receipt for identical photo content.
    // Wait on that canonical receipt, not the superseded local selection UUID.
    requestIds.add(photo.requestId);
  }
  // Previously verified history is already covered by the source-photo gate.
  // It must not consume the per-checkout limit for new transfers.
  return [...requestIds];
}

/** Only our photo writes may change the source while preparing the final closeout. */
export const checkoutFieldsKey=(source:Record<string,unknown>)=>JSON.stringify({...source,photoEvidence:null});
export function sameCheckoutFields(before:Record<string,unknown>,after:Record<string,unknown>) {
  return checkoutFieldsKey(before)===checkoutFieldsKey(after);
}
