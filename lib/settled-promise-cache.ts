// TTL begins at settlement. A slow in-flight refresh remains shared indefinitely.
export function createSettledPromiseCache<T>(ttlMs:number, now=Date.now, maximum=32) {
  const entries=new Map<string,{pending:boolean;expiresAt:number;value:Promise<T>}>();
  const read = (key:string,load:()=>Promise<T>):Promise<T>=>{
    const cached=entries.get(key);
    if(cached && (cached.pending || cached.expiresAt>now()))return cached.value;
    for(const [k,entry]of entries)if(!entry.pending&&entry.expiresAt<=now())entries.delete(k);
    // Never evict in-flight entries and create overlapping work for those keys.
    if(entries.size>=maximum&&!cached){
      const evict=[...entries].find(([,entry])=>!entry.pending);
      if(evict)entries.delete(evict[0]);
      else return Promise.race([...entries.values()].map(entry=>entry.value.catch(()=>undefined))).then(()=>read(key,load));
    }
    const entry={pending:true,expiresAt:Infinity,value:Promise.resolve().then(load)};
    entries.set(key,entry);
    entry.value.then(()=>{entry.pending=false;entry.expiresAt=now()+ttlMs;},()=>{if(entries.get(key)===entry)entries.delete(key);});
    return entry.value;
  };
  return read;
}
