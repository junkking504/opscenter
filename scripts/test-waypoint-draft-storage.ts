import assert from 'node:assert/strict';
import {createWaypointViewGuard} from '../app/crew-jobs/view-guard';
import {mergePhotoAlias} from '../app/crew-jobs/photo-storage';
import {createHandoff,draftHandoff,retireHandoff,type CheckoutHandoff} from '../app/crew-jobs/checkout-handoff';
import {appointmentDraftScope,crewCloseoutKey,migrateCloseoutDraft,preserveCloseoutDraft,preservedCloseoutDrafts,readCloseoutLocal} from '../desktop-ui/lib/closeout-drafts';

async function main(){
 const storage:Record<string,any>={getItem(key:string){return typeof this[key]==='string'?this[key]:null;},setItem(key:string,value:string){this[key]=String(value);},removeItem(key:string){delete this[key];}};
 Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
 for(const kind of ['details','busy','switching','editingCrew'] as const){
  const guard=createWaypointViewGuard(),before=guard.version();guard.set(kind,true);guard.defer();
  assert.equal(guard.current(before),false);assert.equal(guard.takeRefresh(),false);
  guard.set(kind,false);assert.equal(guard.current(before),false,'Closing a view cannot revive its older response');assert.equal(guard.takeRefresh(),true);assert.equal(guard.takeRefresh(),false);
 }
 const guard=createWaypointViewGuard();guard.select('A');const generation=guard.version();guard.select('B');assert.equal(guard.current(generation),false);assert.equal(guard.selected(),'B');
 const scope=appointmentDraftScope({date:'2026-10-06',appointmentId:'900002'}),key=crewCloseoutKey('phone',scope),alias=crewCloseoutKey('phone','old-assignment');
 const raw=JSON.stringify({at:Date.now(),value:{fields:{loadPrice:'321'}}});storage.setItem(`${alias}:draft`,raw);migrateCloseoutDraft(key,[alias]);assert.equal(storage.getItem(`${key}:draft`),raw);assert.equal(storage.getItem(`${alias}:draft`),raw);
 storage.setItem(`${alias}:draft`,JSON.stringify({at:Date.now()+1,value:{fields:{loadPrice:'777'}}}));migrateCloseoutDraft(key,[alias]);assert.equal(storage.getItem(`${key}:draft`),raw,'Canonical draft wins over late legacy copies');
 preserveCloseoutDraft(key);preserveCloseoutDraft(key);assert.equal(preservedCloseoutDrafts(key).length,1);assert.equal(preservedCloseoutDrafts(key)[0].raw,raw);
 const expired=JSON.stringify({at:Date.now()-25*3600000,value:{amount:'321'}});storage.setItem(`${key}:draft`,expired);assert.equal(readCloseoutLocal(`${key}:draft`),null);assert.equal(storage.getItem(`${key}:draft`),expired);
 storage.setItem(`${key}:receipt`,expired);assert.deepEqual(readCloseoutLocal(`${key}:receipt`),{amount:'321'},'Receipt locks do not expire with draft display age');
 storage.setItem(`${key}:draft`,'{bad');assert.equal(readCloseoutLocal(`${key}:draft`),null);assert.equal(storage.getItem(`${key}:draft`),'{bad');preserveCloseoutDraft(key);assert.ok(preservedCloseoutDrafts(key).some(row=>row.raw==='{bad'));
 const selected={requestId:'photo',category:'before' as const,status:'selected' as const,image:'bytes'};
 assert.equal(mergePhotoAlias(selected,{...selected,status:'pending',assignmentId:'old'}).status,'uncertain');
 assert.equal(mergePhotoAlias({...selected,status:'verified',assignmentId:'old'},selected).status,'verified');
 assert.throws(()=>mergePhotoAlias(selected,{...selected,image:'different'}),/Conflicting/);
 assert.throws(()=>mergePhotoAlias({...selected,status:'pending',assignmentId:'old'},{...selected,status:'pending',assignmentId:'other'}),/Conflicting/);
 const base:CheckoutHandoff={deviceId:'phone',assignmentId:'old',draftKey:key,requestId:'old-request',createdAt:1,phase:'attention',payload:{requestId:'old-request'},photoIds:[],acceptedPhotos:{},message:'unknown'};
 storage.setItem('ops-crew-closeout:phone:old:handoff',JSON.stringify(base));
 storage.setItem('ops-crew-closeout:phone:new:handoff',JSON.stringify({...base,assignmentId:'new',requestId:'failed-newer',createdAt:2,receipt:{requestId:'failed-newer',status:'failed'}}));
 assert.equal(draftHandoff('phone',key,['new'])?.requestId,'old-request','An unresolved older alias wins over a later failed attempt');
 await assert.rejects(createHandoff('phone','new',{requestId:'must-not-start'},{draftKey:key,photoKey:'photos',assignmentIds:['old','new']}),/already has a saved submission/);
 assert.equal(storage.getItem('ops-crew-closeout:phone:old:handoff'),JSON.stringify(base),'Duplicate rejection preserves immutable submission bytes');
 retireHandoff('phone','old');assert.equal(storage.getItem('ops-crew-closeout:phone:old:handoff'),null);assert.ok(Object.keys(storage).some(k=>k.startsWith('ops-crew-closeout:phone:old:handoff:retired:')&&storage[k]===JSON.stringify(base)));
 console.log('PASS: editor generations, modal guards, non-destructive draft migration/archive, expired/corrupt preservation, receipt retention, conservative photo merge and duplicate prevention across aliases. No network.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
