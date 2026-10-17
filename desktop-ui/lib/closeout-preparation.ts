/** One-use, in-memory preparation owned by a single appointment drawer.
 * This is only a form-opening optimization, never submission authorization.
 */
export function createCloseoutPreparation<T>(read:(signal:AbortSignal)=>Promise<T>, now=Date.now, maxAgeMs=60_000) {
  type Entry={promise:Promise<T>;readyAt:number|null};
  let entry:Entry|null=null;
  let attempted=false;
  const controllers=new Set<AbortController>();
  function start():Entry {
    const controller=new AbortController();
    controllers.add(controller);
    const result:Entry={readyAt:null,promise:Promise.resolve().then(()=>read(controller.signal)).then(value=>{
      if(controller.signal.aborted)throw new DOMException('Preparation discarded','AbortError');
      result.readyAt=now();
      return value;
    }).finally(()=>controllers.delete(controller))};
    return result;
  }
  return {
    prepare() {
      if(attempted)return;
      attempted=true;
      const pending=start();
      entry=pending;
      // A speculative failure must not surface as an unhandled rejection or
      // poison a later user-requested retry. Never retry in the background.
      void pending.promise.catch(()=>{if(entry===pending)entry=null;});
    },
    take():Promise<T> {
      attempted=true;
      const prepared=entry;
      entry=null;
      if(prepared && (prepared.readyAt===null || now()-prepared.readyAt<maxAgeMs))return prepared.promise;
      return start().promise;
    },
    clear() {
      entry=null;
      for(const controller of controllers)controller.abort();
      controllers.clear();
    },
  };
}
