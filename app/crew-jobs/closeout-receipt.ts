import type {Receipt} from '../../desktop-ui/schedule-receipt';

/** A receipt belongs to one immutable checkout. Acceptance is not completion. */
export function checkedCrewReceipt(receipt:Receipt,requestId:string):Receipt {
  if(receipt.requestId!==requestId || receipt.action && receipt.action!=='closeout')throw new Error('Checkout receipt does not match this submission. Check saved result; do not submit again.');
  if(receipt.status==='verified' && (receipt.sourceResult?.closeout as {status?:{value?:string}})?.status?.value!=='8')return {...receipt,status:'uncertain',message:'Completion is not verified in JunkWare. Check saved result; do not submit again.'};
  return receipt;
}
