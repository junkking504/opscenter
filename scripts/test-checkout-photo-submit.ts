import assert from 'node:assert/strict';
import {submitCheckoutPhotos,checkoutFieldsKey,sameCheckoutFields,type CheckoutPhoto} from '../app/crew-jobs/photo-checkout';
const selected=(id:string):CheckoutPhoto=>({requestId:id,category:id==='before'?'before':'after',status:'selected',image:'local-draft'});
async function main(){
  let rows=[selected('before'),selected('after')],writes:string[]=[],checks:string[]=[];
  let failAfter=true,paymentWrites=0;
  const change=(row:CheckoutPhoto,status:CheckoutPhoto['status'])=>{
    const next={...row,status};rows=rows.map(item=>item.requestId===row.requestId?next:item);return next;
  };
  const actions={
    progress:(_message:string)=>{},
    upload:async(row:CheckoutPhoto)=>{writes.push(row.requestId);return change(row,row.requestId==='after'?'uncertain':'verified');},
    check:async(row:CheckoutPhoto)=>{checks.push(row.requestId);return change(row,failAfter?'uncertain':'verified');},
  };
  const submit=async()=>{await submitCheckoutPhotos(rows,actions);paymentWrites++;};
  assert.deepEqual(writes,[],'Photo selection/draft creation performs no uploads');
  await assert.rejects(submit(),/verification is pending/);
  assert.deepEqual(writes,['before','after']);assert.equal(paymentWrites,0,'Photo uncertainty blocks the final write, not draft progression');
  failAfter=false;await submit();
  assert.deepEqual(writes,['before','after'],'Final retry checks the uncertain photo and never repeats uploaded photos');
  assert.deepEqual(checks,['after','after']);assert.equal(paymentWrites,1);
  let absent=0;
  await submitCheckoutPhotos([{...selected('before'),status:'pending'}],{
    progress:()=>{},check:async row=>{absent++;return {...row,status:'selected'};},
    upload:async row=>{assert.equal(row.requestId,'before');return {...row,status:'verified'};},
  });assert.equal(absent,1,'An absent receipt permits upload with the original identity on explicit final submission');
  await assert.rejects(submitCheckoutPhotos([{...selected('after'),status:'uncertain'}],{
    progress:()=>{},check:async()=>{throw new Error('Offline');},upload:async()=>{throw new Error('Must not upload');},
  }),/Offline/);
  const before={loadPrice:'728',payments:[],photoEvidence:{urls:[]}},after={...before,photoEvidence:{urls:['verified-source']}};
  assert.equal(sameCheckoutFields(before,after),true,'Photo-only source changes preserve the reviewed draft');
  assert.equal(checkoutFieldsKey(before),checkoutFieldsKey(after),'Reload can restore a draft after partial photo submission');
  assert.equal(sameCheckoutFields(before,{...after,loadPrice:'800'}),false,'Manager price edits require new review');
  assert.equal(sameCheckoutFields(before,{...after,payments:[{amount:'728'}]}),false,'New source payments must never be ignored');
  console.log('PASS: final-only uploads, partial batch recovery, original request identities, no payment on photo uncertainty, photo-only draft restoration and concurrent source edits. Synthetic only.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
