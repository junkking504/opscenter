import type {PrebookingCheck} from '../../lib/prebooking-duplicates';
/** Retry only the read-only review; creation is a separate explicit confirmation. */
export async function reviewBooking(payload:unknown,dependencies:{fetch?:typeof fetch;wait?:(ms:number)=>Promise<void>;now?:()=>number}={}):Promise<PrebookingCheck> {
  const request=dependencies.fetch || fetch,wait=dependencies.wait || (ms=>new Promise(resolve=>setTimeout(resolve,ms))),now=dependencies.now || Date.now;
  const deadline=now()+210_000, body=JSON.stringify(payload);
  let collectionStarted=false;
  while(now()<deadline){
    let response:Response;
    try {response=await request('/api/desktop/schedule/creation/check',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...(collectionStarted?{'X-OpsCenter-Review-Poll':'1'}:{})},body,signal:AbortSignal.timeout(Math.min(20000,Math.max(1,deadline-now())))});}
    catch{throw new Error('JunkWare could not finish checking this date. Your details are saved. Try Review Booking again.');}
    const result=await response.json().catch(()=>{throw new Error('JunkWare could not check this date. Your details are saved. Try Review Booking again.');});
    if(response.status===202 && result.pending===true){collectionStarted ||= result.collectionStarted===true;await wait(2000);continue;}
    if(!response.ok || !result.check)throw new Error(result.error || 'JunkWare could not check this booking. Your details are saved. Try Review Booking again.');
    return result.check;
  }
  throw new Error('JunkWare is taking longer to check this date. Your details are saved. Try Review Booking again shortly.');
}
