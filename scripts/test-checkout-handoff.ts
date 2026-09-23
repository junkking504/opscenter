import assert from 'node:assert/strict';
import {transferCheckout,type CheckoutHandoff} from '../app/crew-jobs/checkout-handoff';
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
  console.log('Checkout handoff passed: interruption, reload, lost acknowledgments, original IDs/payload, local-only receipt checks, provider uncertainty and revocation. No live writes.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
