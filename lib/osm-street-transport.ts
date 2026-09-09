import {createHash} from 'node:crypto';

// Shared by all viewers in this server process. FOSSGIS permits at most one
// request/second; reuse geometry as the growing daily trace revisits batches.
const cache=new Map<string,{until:number;value:unknown}>();
const pending=new Map<string,Promise<unknown>>();
let queue=Promise.resolve(),nextStart=0;
export function osmStreetJson(path:string):Promise<unknown> {
  const key=createHash('sha256').update(path).digest('hex'),cached=cache.get(key);
  if(cached && cached.until>Date.now())return Promise.resolve(cached.value);
  const existing=pending.get(key);if(existing)return existing;
  if(pending.size>=12)return Promise.resolve(null);
  const request=queue.then(async()=>{
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,nextStart-Date.now())));
    nextStart=Date.now()+1100;
    let value:unknown=null;
    try {
      const response=await fetch(`https://routing.openstreetmap.de/routed-car/${path}`,{
        headers:{'User-Agent':'OpsCenter/1.0 (https://ops.junk-king.app)'},
        signal:AbortSignal.timeout(5000),cache:'no-store',redirect:'error',
      });
      if(response.ok)value=await response.json();
    } catch { /* Keep unavailable road sections disconnected. */ }
    cache.delete(key);cache.set(key,{value,until:Date.now()+(value?24*60*60_000:120_000)});
    while(cache.size>256)cache.delete(cache.keys().next().value!);
    return value;
  });
  queue=request.then(()=>{},()=>{});
  pending.set(key,request);void request.finally(()=>pending.delete(key));return request;
}
