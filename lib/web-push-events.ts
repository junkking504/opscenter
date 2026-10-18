import { pushHash, type PushCategory } from './web-push-policy';
export type PushObservation = { identity: string; revision: unknown };
/** Ordered, retained canonical snapshots. A watcher over an overwritten file does
 * NOT satisfy this contract. Sequence is durable and contiguous within a scope. */
export type PushBatch = { scope:string; category:PushCategory; sequence:number;
  observedAt:string; recordedAt?:string; generation?:string; reset?:boolean; reconcile?:boolean; gapIds?:string[]; gapId?:string; baseline?:boolean; complete:boolean; observations:PushObservation[] };
export function pushEventId(batch: Pick<PushBatch,'scope'|'category'>, item: PushObservation, version=1) {
  return pushHash(['opscenter-push-v1',batch.scope,batch.category,item.identity,item.revision,version]);
}
/** Pure diff: a missing row means removed only with explicit complete evidence. */
export function pushTransitions(previous: Map<string,{revision_hash:string;version:number;present:boolean}>, batch:PushBatch) {
  const seen=new Set<string>();
  const changes:Array<{identity:string;revision:string;version:number;present:boolean}>=[];
  for(const item of batch.observations){
    const identity=pushHash(item.identity),revision=pushHash({present:true,revision:item.revision});
    if(seen.has(identity))throw new Error('duplicate_identity');
    seen.add(identity);const prior=previous.get(identity);
    if(!prior || prior.revision_hash!==revision || !prior.present)changes.push({identity,revision,version:(prior?.version||0)+1,present:true});
  }
  if(batch.complete && batch.category==='schedule')for(const [identity,prior] of previous){
    if(prior.present && !seen.has(identity))changes.push({identity,revision:pushHash({present:false}),version:prior.version+1,present:false});
  }
  return changes;
}
