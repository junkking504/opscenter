import type {CheckoutPhoto} from './photo-checkout';

/** Presentation only: only a verified receipt counts as saved in JunkWare. */
export function photoProgressCounts(photos:CheckoutPhoto[]) {
  const counts={total:photos.length,saved:0,selected:0,queued:0,transferring:0,verifying:0,attention:0};
  for(const photo of photos){
    if(photo.status==='verified')counts.saved++;
    else if(photo.transferError)counts.attention++;
    else if(photo.status==='pending')counts.verifying++;
    else if(photo.status==='selected')photo.submitted?counts.queued++:counts.selected++;
    else if(photo.submitted && !photo.receiptId)counts.transferring++;
    else counts.attention++;
  }
  return counts;
}
