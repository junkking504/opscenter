export type CheckoutPhoto = {requestId:string;category:'before'|'after';status:'selected'|'pending'|'verified'|'uncertain';image?:string};

/** Final-confirmation only. Resume saved upload identities; never replay an uncertain write. */
export async function submitCheckoutPhotos(photos:CheckoutPhoto[],actions:{
  upload:(photo:CheckoutPhoto)=>Promise<CheckoutPhoto>;
  check:(photo:CheckoutPhoto)=>Promise<CheckoutPhoto>;
  progress:(message:string)=>void;
}) {
  for(const [index,initial] of photos.entries()) {
    let photo=initial;
    if(photo.status==='verified')continue;
    actions.progress(`Uploading and verifying photo ${index+1} of ${photos.length}…`);
    if(photo.status==='pending' || photo.status==='uncertain')photo=await actions.check(photo);
    if(photo.status==='selected')photo=await actions.upload(photo);
    if(photo.status!=='verified')photo=await actions.check(photo);
    if(photo.status!=='verified')throw new Error('Photo verification is pending. Submit checkout again to check the saved result. Payment has not been submitted.');
  }
}

/** Only our photo writes may change the source while preparing the final closeout. */
export const checkoutFieldsKey=(source:Record<string,unknown>)=>JSON.stringify({...source,photoEvidence:null});
export function sameCheckoutFields(before:Record<string,unknown>,after:Record<string,unknown>) {
  return checkoutFieldsKey(before)===checkoutFieldsKey(after);
}
