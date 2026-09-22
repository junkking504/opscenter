import assert from 'node:assert/strict';
import {stageCheckoutPhotos,checkoutFieldsKey,sameCheckoutFields,type CheckoutPhoto} from '../app/crew-jobs/photo-checkout';
const selected=(id:string):CheckoutPhoto=>({requestId:id,category:id==='before'?'before':'after',status:'selected',image:'local-draft'});
async function main(){
  let rows=[selected('before'),selected('after')],writes:string[]=[],checks:string[]=[];
  const change=(row:CheckoutPhoto,status:CheckoutPhoto['status'])=>{
    const next={...row,status};rows=rows.map(item=>item.requestId===row.requestId?next:item);return next;
  };
  const actions={
    progress:(_message:string)=>{},
    upload:async(row:CheckoutPhoto)=>{writes.push(row.requestId);return change(row,row.requestId==='after'?'verified':'pending');},
    check:async(row:CheckoutPhoto)=>{checks.push(row.requestId);return change(row,'verified');},
  };
  assert.deepEqual(writes,[],'Photo selection/draft creation performs no uploads');
  assert.deepEqual(await stageCheckoutPhotos(rows,actions),['before','after']);
  assert.deepEqual(writes,['before','after'],'One submit transfers each selected photo once');
  assert.deepEqual([...checks],[],'A durable pending transfer does not block on JunkWare verification');
  await stageCheckoutPhotos([{...selected('before'),status:'pending'}],{
    progress:()=>{},check:async (row:CheckoutPhoto)=>{checks.push(row.requestId);return {...row,status:'verified' as const};},
    upload:async(_row:CheckoutPhoto):Promise<CheckoutPhoto>=>{throw new Error('Must not repeat a staged transfer');},
  });assert.deepEqual([...checks],[],'A pending staged photo is left for the background worker');
  await stageCheckoutPhotos([{...selected('after'),status:'uncertain'}],{
    progress:()=>{},check:async (row:CheckoutPhoto)=>{checks.push(row.requestId);return {...row,status:'verified' as const};},upload:async(_row:CheckoutPhoto):Promise<CheckoutPhoto>=>{throw new Error('Must not upload uncertain photo');},
  });assert.deepEqual([...checks],['after'],'An uncertain photo is read back once and never uploaded again');
  await assert.rejects(stageCheckoutPhotos([{...selected('after'),status:'uncertain'}],{
    progress:()=>{},check:async(_row:CheckoutPhoto):Promise<CheckoutPhoto>=>{throw new Error('Offline');},upload:async(_row:CheckoutPhoto):Promise<CheckoutPhoto>=>{throw new Error('Must not upload');},
  }),/Offline/);
  const before={loadPrice:'728',payments:[],photoEvidence:{urls:[]}},after={...before,photoEvidence:{urls:['verified-source']}};
  assert.equal(sameCheckoutFields(before,after),true,'Photo-only source changes preserve the reviewed draft');
  assert.equal(checkoutFieldsKey(before),checkoutFieldsKey(after),'Reload can restore a draft after partial photo submission');
  assert.equal(sameCheckoutFields(before,{...after,loadPrice:'800'}),false,'Manager price edits require new review');
  assert.equal(sameCheckoutFields(before,{...after,payments:[{amount:'728'}]}),false,'New source payments must never be ignored');
  console.log('PASS: final-only durable staging, background verification handoff, original request identities, no uncertain replay, photo-only draft restoration and concurrent source edits. Synthetic only.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
