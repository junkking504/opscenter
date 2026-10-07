import assert from 'node:assert/strict';
import {reopenAttentionHandoff,transferCheckout,type CheckoutHandoff} from '../app/crew-jobs/checkout-handoff';
import type {Receipt} from '../desktop-ui/schedule-receipt';

async function main(){
  const initial:CheckoutHandoff={deviceId:'phone',assignmentId:'assignment',requestId:'checkout-original',createdAt:1,phase:'transferring',
    payload:{requestId:'checkout-original',values:{addPayment:{amount:120}}},photoIds:['photo-one','photo-two'],acceptedPhotos:{},message:''};
  let saved=structuredClone(initial),closeout:Receipt|null=null,closeoutPosts=0,photoPosts=0,losePhotoResponse=true,loseCheckoutResponse=false,failBeforeAccept=false;
  const photos=new Map<string,{requestId:string;status:string}>();
  const bodies:string[]=[];
  const request:typeof fetch=async(input,options)=>{
    const url=new URL(String(input),'https://waypoint.example');
    if(url.pathname.endsWith('/photos')){
      if(options?.method==='POST'){
        photoPosts++;const body=JSON.parse(String(options.body));
        const receipt={requestId:body.requestId,status:'pending'};photos.set(body.requestId,receipt);
        if(losePhotoResponse){losePhotoResponse=false;throw new Error('iOS suspended before acknowledgment');}
        return Response.json({receipt}, {status:202});
      }
      assert.equal(url.searchParams.get('receiptOnly'),'1','No slow provider check during intake recovery');
      const receipt=photos.get(url.searchParams.get('requestId')!);
      return receipt?Response.json({receipt}):Response.json({error:'not found'},{status:404});
    }
    if(options?.method==='POST'){
      closeoutPosts++;bodies.push(String(options.body));
      assert.equal(saved.phase,'submitting','Persist immutable closeout before its POST');
      if(failBeforeAccept){failBeforeAccept=false;throw new Error('request did not arrive');}
      closeout={requestId:'checkout-original',action:'closeout',status:'pending',message:'Provider pending'};
      if(loseCheckoutResponse){loseCheckoutResponse=false;throw new Error('lost receipt');}
      return Response.json({receipt:closeout},{status:202});
    }
    return closeout?Response.json({receipt:closeout}):Response.json({error:'not found'},{status:404});
  };
  const deps={fetch:request,photos:async()=>initial.photoIds.map(requestId=>({requestId,category:'before' as const,status:'pending' as const,image:'retained-on-phone'})),save:(value:CheckoutHandoff)=>{saved=structuredClone(value);},keepReceipt:(_value:Receipt)=>{}};
  assert.equal(await transferCheckout(saved,deps),null);
  assert.equal(saved.phase,'transferring');assert.match(saved.message,/Transfer paused/);assert.equal(closeoutPosts,0);
  loseCheckoutResponse=true;
  assert.equal(await transferCheckout(structuredClone(saved),deps),null);
  assert.equal(photoPosts,2,'Lost photo acknowledgement is recovered without another upload');
  assert.equal(saved.phase,'submitting');assert.equal(closeoutPosts,1);
  await transferCheckout(structuredClone(saved),deps);
  assert.equal(saved.phase,'accepted');assert.match(saved.message,/Safe to close/);assert.match(saved.message,/pending/);
  assert.equal(closeoutPosts,1,'Lost checkout acknowledgement is read back, never duplicated');
  closeout={requestId:'checkout-original',action:'closeout',status:'verified',message:'Verified'};
  await transferCheckout(saved,deps);assert.match(saved.message,/verified in JunkWare/);
  saved=structuredClone(initial);closeout=null;photos.clear();failBeforeAccept=true;
  await transferCheckout(saved,deps);const frozen=structuredClone(saved);
  assert.equal(frozen.phase,'submitting');await transferCheckout(frozen,deps);
  assert.equal(bodies.at(-1),bodies.at(-2),'A request that never arrived resumes with the exact same UUID and reviewed payload');
  saved=structuredClone(initial);closeout=null;photos.set('photo-one',{requestId:'photo-one',status:'uncertain'});
  const before=photoPosts;await transferCheckout(saved,deps);
  assert.equal(saved.phase,'attention');assert.equal(photoPosts,before,'Uncertain provider uploads are never replayed');
  saved=structuredClone(initial);photos.clear();
  await transferCheckout(saved,{...deps,photos:async()=>[]});assert.equal(saved.phase,'attention','Missing local bytes cannot be called server-saved');
  saved=structuredClone(initial);
  await transferCheckout(saved,{...deps,fetch:async()=>Response.json({error:'revoked'},{status:401})});assert.equal(saved.phase,'attention','Revoked access stops recovery');
  const reopened=reopenAttentionHandoff(saved);assert.equal(reopened?.phase,'transferring');assert.equal(reopened?.requestId,saved.requestId);assert.deepEqual(reopened?.payload,saved.payload);
  assert.equal(reopenAttentionHandoff({...saved,receipt:{requestId:saved.requestId,action:'closeout',status:'pending',message:'accepted'}}),null,'An accepted handoff is never reopened');
  // Drain in-flight acknowledgments on failure and never queue a partial batch.
  {
    const batch={...structuredClone(initial),photoIds:['one','two','three','four']};
    let latest=structuredClone(batch),active=0,peak=0,posts=0,checkoutPosts=0;
    let fail=true;
    const receipts=new Map<string,{requestId:string;status:string}>();
    const gates:Array<()=>void>=[];
    const fetchBatch:typeof fetch=async(input,options)=>{
      const url=new URL(String(input),'https://waypoint.example');
      if(options?.method!=='POST'){
        const receipt=receipts.get(url.searchParams.get('requestId')!);
        return receipt?Response.json({receipt}):Response.json({}, {status:404});
      }
      if(url.pathname.endsWith('/photos')){
        const id=JSON.parse(String(options.body)).requestId;posts++;active++;peak=Math.max(peak,active);
        await new Promise<void>(resolve=>gates.push(resolve));active--;
        if(id==='one' && fail)throw new Error('Connection interrupted');
        const receipt={requestId:id,status:'pending'};receipts.set(id,receipt);return Response.json({receipt},{status:202});
      }
      checkoutPosts++;
      assert.equal(active,0);assert.equal(Object.keys(latest.acceptedPhotos).length,4);
      assert.deepEqual(JSON.parse(String(options.body)).photoRequestIds,batch.photoIds);
      return Response.json({receipt:{requestId:batch.requestId,status:'pending',action:'closeout',message:'Saved'}},{status:202});
    };
    const depsBatch={fetch:fetchBatch,photos:async()=>batch.photoIds.map(requestId=>({requestId,category:'before' as const,status:'selected' as const,image:'saved'})),save:(value:CheckoutHandoff)=>{latest=structuredClone(value);},keepReceipt:()=>{}};
    const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
    let finished=false;const first=transferCheckout(batch,depsBatch).then(()=>{finished=true;});
    while(gates.length<2)await tick();
    gates.shift()!();await tick();assert.equal(finished,false,'Failure waits for the other active intake');
    gates.shift()!();await first;
    assert.equal(posts,2,'Failure prevents starting queued photos');assert.equal(checkoutPosts,0);
    assert.equal(latest.acceptedPhotos.two,'two','Late acknowledgment survives the pause');
    assert.match(latest.message,/Transfer paused/);fail=false;
    const recovered=transferCheckout(latest,depsBatch);
    while(gates.length<2)await tick();gates.splice(0).forEach(resolve=>resolve());
    while(!gates.length)await tick();gates.splice(0).forEach(resolve=>resolve());
    await recovered;
    assert.equal(peak,2,'At most two phone transfers');assert.equal(posts,5,'Only missing bytes resume');
    assert.equal(checkoutPosts,1);assert.equal(latest.phase,'accepted');
  }
  console.log('Checkout handoff passed: interruption, reload, lost acknowledgments, original IDs/payload, local-only receipt checks, provider uncertainty and revocation. No live writes.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
